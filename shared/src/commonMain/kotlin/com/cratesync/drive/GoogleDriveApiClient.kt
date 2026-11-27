package com.cratesync.drive

import com.cratesync.core.BinaryAudioParser
import com.cratesync.core.ParsedAudioTags
import com.cratesync.core.isSupportedAudioFileName
import com.cratesync.platform.currentTimeMillis
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsBytes
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

interface DriveChildrenGateway {
    suspend fun listDirectChildren(parentId: String): Pair<List<DriveFolderItem>, Int>
}

/**
 * Fair 3-phase DFS folder counter for Google Drive trees (including 10 TB+ Drives).
 * Never uses global mimeType/extension queries; strictly queries `'parentId' in parents`
 * with Fast Fair Probe -> Round-Robin Audio Expansion -> Tail Probe so deep folders
 * like `Music` are never starved by sibling config/backup trees.
 */
class DriveFairDfsFolderCounter(
    private val gateway: DriveChildrenGateway,
    private val clockMs: () -> Long = ::currentTimeMillis,
) {
    private val cache = mutableMapOf<String, DriveFolderCountStats>()

    suspend fun countFolderStats(
        roots: List<DriveFolderItem>,
        deadlineMs: Long = 22_000L,
        onUpdate: (Map<String, DriveFolderCountStats>) -> Unit = {},
    ): Map<String, DriveFolderCountStats> {
        val startedAt = clockMs()
        val results = mutableMapOf<String, DriveFolderCountStats>()
        val queues = LinkedHashMap<String, ArrayDeque<String>>()
        val expanded = mutableMapOf<String, Int>()
        val audioFound = mutableMapOf<String, Int>()
        val folderFound = mutableMapOf<String, Int>()

        for (root in roots) {
            val cached = cache[root.id]
            if (cached != null && !cached.isPartial) {
                results[root.id] = cached
            } else {
                queues[root.id] = ArrayDeque<String>().apply { addLast(root.id) }
                expanded[root.id] = 0
                audioFound[root.id] = 0
                folderFound[root.id] = 0
                results[root.id] = DriveFolderCountStats(0, 0, isPartial = true)
            }
        }
        onUpdate(results.toMap())

        suspend fun stepRoot(rootId: String): Boolean {
            val q = queues[rootId] ?: return false
            if (q.isEmpty()) return false
            val current = q.removeFirst()
            val (subfolders, audioCount) = gateway.listDirectChildren(current)
            expanded[rootId] = (expanded[rootId] ?: 0) + 1
            audioFound[rootId] = (audioFound[rootId] ?: 0) + audioCount
            folderFound[rootId] = (folderFound[rootId] ?: 0) + subfolders.size
            for (sub in subfolders) q.addFirst(sub.id)
            val partial = q.isNotEmpty()
            val stat = DriveFolderCountStats(audioFound[rootId] ?: 0, folderFound[rootId] ?: 0, isPartial = partial)
            results[rootId] = stat
            if (!partial) cache[rootId] = stat // Never cache deadline-interrupted roots
            return true
        }

        // Phase 1: Fast Fair Probe (up to 4 probes per root so every visible root gets immediate counts)
        repeat(4) {
            if (clockMs() - startedAt > deadlineMs) return results
            var anyProgressed = false
            for (root in roots) {
                if (clockMs() - startedAt > deadlineMs) break
                if (stepRoot(root.id)) anyProgressed = true
            }
            onUpdate(results.toMap())
            if (!anyProgressed) return results
        }

        // Phase 2: Round-Robin Audio Expansion (prioritize roots where audio is discovered or likely)
        while (clockMs() - startedAt <= deadlineMs) {
            val pendingRoots = roots.filter { queues[it.id]?.isNotEmpty() == true }
                .sortedByDescending { r ->
                    val audio = audioFound[r.id] ?: 0
                    val musicHint = if (r.name.contains("music", true) || r.name.contains("audio", true)) 1 else 0
                    (if (audio > 0) 10_000 else 0) + musicHint * 1000 - (expanded[r.id] ?: 0)
                }
            if (pendingRoots.isEmpty()) break
            for (root in pendingRoots) {
                if (clockMs() - startedAt > deadlineMs) break
                stepRoot(root.id)
            }
            onUpdate(results.toMap())
        }

        return results
    }
}

/**
 * Ktor multiplatform Google Drive v3 client supporting:
 * - Least-privilege scopes (`drive.readonly` + `drive.file`)
 * - 3-phase fair DFS folder browser
 * - Partial HTTP byte-range header reading (128 KB head + 128 B ID3v1 tail) without downloading full files
 * - Multipart (<= 5 MB) and Resumable chunked uploads (> 5 MB)
 * - Canonical `cratesync-source-of-truth.json` manifest sync
 */
class GoogleDriveApiClient(
    private val httpClient: HttpClient,
    private val accessTokenProvider: () -> String?,
) : DriveChildrenGateway {
    companion object {
        const val DRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files"
        const val DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files"
        const val MANIFEST_FILE_NAME = "cratesync-source-of-truth.json"
        const val MULTIPART_THRESHOLD_BYTES = 5L * 1024L * 1024L
        const val BYTE_RANGE_HEAD_SIZE = 131_072L
    }

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private fun requireToken(): String =
        accessTokenProvider()?.takeIf { it.isNotBlank() }
            ?: error("Sign in to Google Drive first.")

    suspend fun listFolders(parentId: String = "root", scope: DriveFolderScope = DriveFolderScope.MY_DRIVE): List<DriveFolderItem> {
        val token = requireToken()
        val query = if (scope == DriveFolderScope.SHARED_WITH_ME && parentId == "root") {
            "mimeType='application/vnd.google-apps.folder' and sharedWithMe=true and trashed=false"
        } else {
            "'$parentId' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
        }
        val out = mutableListOf<DriveFolderItem>()
        var pageToken: String? = null
        do {
            val resp = httpClient.get(DRIVE_FILES_API) {
                header(HttpHeaders.Authorization, "Bearer $token")
                parameter("q", query)
                parameter("fields", "nextPageToken,files(id,name,modifiedTime,parents)")
                parameter("pageSize", 200)
                parameter("orderBy", "name_natural")
                if (!pageToken.isNullOrBlank()) parameter("pageToken", pageToken)
            }
            val text = resp.bodyAsText()
            if (!resp.status.isSuccess()) error("Drive listFolders failed (${resp.status.value}): $text")
            val root = json.parseToJsonElement(text).jsonObject
            for (el in root["files"]?.jsonArray.orEmpty()) {
                val obj = el.jsonObject
                out += DriveFolderItem(
                    id = obj["id"]?.jsonPrimitive?.contentOrNull ?: continue,
                    name = obj["name"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    modifiedTime = obj["modifiedTime"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    parents = obj["parents"]?.jsonArray.orEmpty().mapNotNull { it.jsonPrimitive.contentOrNull },
                )
            }
            pageToken = root["nextPageToken"]?.jsonPrimitive?.contentOrNull
        } while (!pageToken.isNullOrBlank())
        return out
    }

    override suspend fun listDirectChildren(parentId: String): Pair<List<DriveFolderItem>, Int> {
        val token = requireToken()
        val subfolders = mutableListOf<DriveFolderItem>()
        var audioCount = 0
        var pageToken: String? = null
        do {
            val resp = httpClient.get(DRIVE_FILES_API) {
                header(HttpHeaders.Authorization, "Bearer $token")
                parameter("q", "'$parentId' in parents and trashed=false")
                parameter("fields", "nextPageToken,files(id,name,mimeType,modifiedTime)")
                parameter("pageSize", 1000)
                if (!pageToken.isNullOrBlank()) parameter("pageToken", pageToken)
            }
            val text = resp.bodyAsText()
            if (!resp.status.isSuccess()) break
            val root = json.parseToJsonElement(text).jsonObject
            for (el in root["files"]?.jsonArray.orEmpty()) {
                val obj = el.jsonObject
                val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: continue
                val name = obj["name"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val mime = obj["mimeType"]?.jsonPrimitive?.contentOrNull.orEmpty()
                if (mime == "application/vnd.google-apps.folder") {
                    subfolders += DriveFolderItem(id, name, obj["modifiedTime"]?.jsonPrimitive?.contentOrNull.orEmpty())
                } else if (isSupportedAudioFileName(name, mime)) {
                    audioCount++
                }
            }
            pageToken = root["nextPageToken"]?.jsonPrimitive?.contentOrNull
        } while (!pageToken.isNullOrBlank())
        return subfolders to audioCount
    }

    suspend fun createFolder(name: String, parentId: String = "root"): DriveFolderItem {
        val token = requireToken()
        val payload = buildJsonObject {
            put("name", name.trim())
            put("mimeType", "application/vnd.google-apps.folder")
            putJsonArray("parents") { add(json.parseToJsonElement("\"$parentId\"")) }
        }
        val resp = httpClient.post(DRIVE_FILES_API) {
            header(HttpHeaders.Authorization, "Bearer $token")
            contentType(ContentType.Application.Json)
            setBody(payload.toString())
        }
        val text = resp.bodyAsText()
        if (!resp.status.isSuccess()) error("Create Drive folder failed: $text")
        val obj = json.parseToJsonElement(text).jsonObject
        return DriveFolderItem(
            id = obj["id"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            name = obj["name"]?.jsonPrimitive?.contentOrNull ?: name.trim(),
        )
    }

    /**
     * Reads embedded audio tags & duration from a Drive file using HTTP Range headers (128 KB head + 128 B tail)
     * without downloading the full multi-megabyte song.
     */
    suspend fun readAudioTagsViaRange(fileId: String, fileName: String, fileSize: Long): ParsedAudioTags {
        val token = requireToken()
        val headEnd = (BYTE_RANGE_HEAD_SIZE - 1).coerceAtMost((fileSize - 1).coerceAtLeast(0L))
        val headResp = httpClient.get("$DRIVE_FILES_API/$fileId") {
            header(HttpHeaders.Authorization, "Bearer $token")
            header(HttpHeaders.Range, "bytes=0-$headEnd")
            parameter("alt", "media")
        }
        val headBytes = if (headResp.status.isSuccess()) headResp.bodyAsBytes() else ByteArray(0)
        val tailBytes = if (fileSize > BYTE_RANGE_HEAD_SIZE + 128L) {
            val tailStart = fileSize - 128L
            val tailResp = httpClient.get("$DRIVE_FILES_API/$fileId") {
                header(HttpHeaders.Authorization, "Bearer $token")
                header(HttpHeaders.Range, "bytes=$tailStart-${fileSize - 1}")
                parameter("alt", "media")
            }
            if (tailResp.status.isSuccess()) tailResp.bodyAsBytes() else null
        } else null

        return BinaryAudioParser.parseHeaderAndTail(headBytes, tailBytes, fileSize, fileName)
    }

    suspend fun downloadFileBytes(fileId: String): ByteArray {
        val token = requireToken()
        val resp = httpClient.get("$DRIVE_FILES_API/$fileId") {
            header(HttpHeaders.Authorization, "Bearer $token")
            parameter("alt", "media")
        }
        if (!resp.status.isSuccess()) error("Drive download failed (${resp.status.value})")
        return resp.bodyAsBytes()
    }

    suspend fun findManifestFileId(folderId: String = "root"): String? {
        val token = requireToken()
        val resp = httpClient.get(DRIVE_FILES_API) {
            header(HttpHeaders.Authorization, "Bearer $token")
            parameter("q", "'$folderId' in parents and name='$MANIFEST_FILE_NAME' and trashed=false")
            parameter("fields", "files(id)")
            parameter("pageSize", 1)
        }
        if (!resp.status.isSuccess()) return null
        val root = json.parseToJsonElement(resp.bodyAsText()).jsonObject
        return root["files"]?.jsonArray?.firstOrNull()?.jsonObject?.get("id")?.jsonPrimitive?.contentOrNull
    }

    suspend fun downloadManifest(fileId: String): DriveManifest {
        val bytes = downloadFileBytes(fileId)
        return json.decodeFromString(bytes.decodeToString())
    }

    suspend fun uploadManifest(manifest: DriveManifest, folderId: String = "root", existingFileId: String? = null): String {
        val payload = json.encodeToString(manifest).encodeToByteArray()
        return uploadBinaryFile(
            fileName = MANIFEST_FILE_NAME,
            mimeType = "application/json",
            bytes = payload,
            folderId = folderId,
            existingFileId = existingFileId,
        )
    }

    /**
     * Uploads audio or manifest files to Drive using multipart upload (<= 5 MB)
     * or Google Drive Resumable Upload session (> 5 MB).
     */
    suspend fun uploadBinaryFile(
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
        folderId: String = "root",
        existingFileId: String? = null,
    ): String {
        val token = requireToken()
        if (bytes.size <= MULTIPART_THRESHOLD_BYTES) {
            val boundary = "cratesync_boundary_${currentTimeMillis()}"
            val meta = buildJsonObject {
                put("name", fileName)
                if (existingFileId == null) {
                    putJsonArray("parents") { add(json.parseToJsonElement("\"$folderId\"")) }
                }
            }.toString()
            val prefix = "--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n$meta\r\n--$boundary\r\nContent-Type: $mimeType\r\n\r\n".encodeToByteArray()
            val suffix = "\r\n--$boundary--".encodeToByteArray()
            val body = ByteArray(prefix.size + bytes.size + suffix.size)
            prefix.copyInto(body, 0)
            bytes.copyInto(body, prefix.size)
            suffix.copyInto(body, prefix.size + bytes.size)

            val url = if (existingFileId != null) "$DRIVE_UPLOAD_API/$existingFileId" else DRIVE_UPLOAD_API
            val resp = if (existingFileId != null) {
                httpClient.patch(url) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                    parameter("uploadType", "multipart")
                    header(HttpHeaders.ContentType, "multipart/related; boundary=$boundary")
                    setBody(body)
                }
            } else {
                httpClient.post(url) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                    parameter("uploadType", "multipart")
                    header(HttpHeaders.ContentType, "multipart/related; boundary=$boundary")
                    setBody(body)
                }
            }
            val text = resp.bodyAsText()
            if (!resp.status.isSuccess()) error("Drive multipart upload failed: $text")
            return json.parseToJsonElement(text).jsonObject["id"]?.jsonPrimitive?.contentOrNull.orEmpty()
        }

        // Resumable upload session for > 5 MB audio masters (FLAC / WAV / AIFF)
        val initUrl = if (existingFileId != null) "$DRIVE_UPLOAD_API/$existingFileId" else DRIVE_UPLOAD_API
        val meta = buildJsonObject {
            put("name", fileName)
            if (existingFileId == null) {
                putJsonArray("parents") { add(json.parseToJsonElement("\"$folderId\"")) }
            }
        }.toString()
        val initResp = if (existingFileId != null) {
            httpClient.patch(initUrl) {
                header(HttpHeaders.Authorization, "Bearer $token")
                parameter("uploadType", "resumable")
                header("X-Upload-Content-Type", mimeType)
                header("X-Upload-Content-Length", bytes.size.toString())
                contentType(ContentType.Application.Json)
                setBody(meta)
            }
        } else {
            httpClient.post(initUrl) {
                header(HttpHeaders.Authorization, "Bearer $token")
                parameter("uploadType", "resumable")
                header("X-Upload-Content-Type", mimeType)
                header("X-Upload-Content-Length", bytes.size.toString())
                contentType(ContentType.Application.Json)
                setBody(meta)
            }
        }
        val uploadUri = initResp.headers[HttpHeaders.Location]
            ?: error("Drive did not return resumable upload Location header.")
        val putResp = httpClient.put(uploadUri) {
            header(HttpHeaders.ContentType, mimeType)
            setBody(bytes)
        }
        val putText = putResp.bodyAsText()
        if (!putResp.status.isSuccess()) error("Drive resumable upload failed: $putText")
        return json.parseToJsonElement(putText).jsonObject["id"]?.jsonPrimitive?.contentOrNull.orEmpty()
    }
}
