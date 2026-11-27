package com.cratesync.youtube

import io.ktor.client.HttpClient
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

enum class YouTubeFailure {
    QUOTA, AUTH, API_DISABLED, NO_CHANNEL, PLAYLIST_MISSING, FORBIDDEN,
    VIDEO_MISSING, ITEM_MISSING, NOT_MANUAL_ORDER, BAD_POSITION, BUSY, NETWORK, OTHER
}

class YouTubeApiException(
    val failure: YouTubeFailure,
    override val message: String,
    val statusCode: Int = 0,
) : Exception(message)

data class YouTubeVideoSummary(
    val videoId: String,
    val title: String,
    val channel: String,
)

data class YouTubePlaylistItem(
    val itemId: String,
    val videoId: String,
    val title: String = "",
    val channel: String = "",
)

interface YouTubeApi {
    suspend fun searchVideos(query: String, maxResults: Int = 6): List<YouTubeVideoSummary>
    suspend fun listExistingVideoIds(videoIds: List<String>): Set<String>
    suspend fun listPlaylistItems(playlistId: String): List<YouTubePlaylistItem>
    suspend fun createPlaylist(title: String, description: String): String
    suspend fun insertPlaylistItem(playlistId: String, videoId: String, position: Int? = null)
    suspend fun deletePlaylistItem(itemId: String)
    suspend fun movePlaylistItem(playlistId: String, itemId: String, videoId: String, position: Int)
}

fun describeYouTubeFailure(failure: YouTubeFailure?): String = when (failure) {
    YouTubeFailure.QUOTA -> "YouTube's daily allowance for CrateSync is used up. It resets at midnight Pacific time."
    YouTubeFailure.AUTH -> "YouTube no longer accepts the connection. Reconnect YouTube and try again."
    YouTubeFailure.API_DISABLED -> "The YouTube Data API is switched off for this Google Cloud project."
    YouTubeFailure.NO_CHANNEL -> "This Google account has no YouTube channel yet. Open YouTube once to create it."
    YouTubeFailure.PLAYLIST_MISSING, YouTubeFailure.FORBIDDEN -> "YouTube cannot find or access that playlist under the connected account."
    YouTubeFailure.BUSY -> "YouTube was too busy to answer. Wait a minute and try again."
    YouTubeFailure.NETWORK -> "CrateSync could not reach YouTube. Check your connection and try again."
    else -> "YouTube refused the request."
}

/**
 * Ktor multiplatform YouTube Data API v3 client using strictly in-memory OAuth access tokens.
 */
class KtorYouTubeApiClient(
    private val httpClient: HttpClient,
    private val accessTokenProvider: () -> String?,
) : YouTubeApi {
    private val baseUrl = "https://www.googleapis.com/youtube/v3"
    private val json = Json { ignoreUnknownKeys = true }

    private fun requireToken(): String =
        accessTokenProvider()?.takeIf { it.isNotBlank() }
            ?: throw YouTubeApiException(YouTubeFailure.AUTH, "Connect YouTube first.")

    private fun mapError(status: Int, body: String): YouTubeApiException {
        val reason = runCatching {
            val root = json.parseToJsonElement(body).jsonObject
            root["error"]?.jsonObject?.get("errors")?.jsonArray?.firstOrNull()?.jsonObject?.get("reason")?.jsonPrimitive?.contentOrNull
        }.getOrNull().orEmpty()

        val failure = when {
            status == 401 -> YouTubeFailure.AUTH
            reason == "quotaExceeded" || reason == "dailyLimitExceeded" -> YouTubeFailure.QUOTA
            reason == "accessNotConfigured" -> YouTubeFailure.API_DISABLED
            reason == "youtubeSignupRequired" -> YouTubeFailure.NO_CHANNEL
            reason == "playlistNotFound" -> YouTubeFailure.PLAYLIST_MISSING
            reason == "videoNotFound" -> YouTubeFailure.VIDEO_MISSING
            reason == "playlistItemNotFound" -> YouTubeFailure.ITEM_MISSING
            reason == "manualSortRequired" -> YouTubeFailure.NOT_MANUAL_ORDER
            reason == "playlistOperationUnsupported" || reason == "invalidPosition" -> YouTubeFailure.BAD_POSITION
            status == 403 -> YouTubeFailure.FORBIDDEN
            status == 429 || status >= 500 -> YouTubeFailure.BUSY
            else -> YouTubeFailure.OTHER
        }
        return YouTubeApiException(failure, describeYouTubeFailure(failure), status)
    }

    override suspend fun searchVideos(query: String, maxResults: Int): List<YouTubeVideoSummary> {
        val token = requireToken()
        val resp = try {
            httpClient.get("$baseUrl/search") {
                header(HttpHeaders.Authorization, "Bearer $token")
                parameter("part", "snippet")
                parameter("type", "video")
                parameter("videoCategoryId", "10")
                parameter("maxResults", maxResults.coerceIn(1, 15))
                parameter("q", query)
            }
        } catch (t: Throwable) {
            throw YouTubeApiException(YouTubeFailure.NETWORK, t.message ?: "Network error")
        }
        val text = resp.bodyAsText()
        if (!resp.status.isSuccess()) throw mapError(resp.status.value, text)

        val root = json.parseToJsonElement(text).jsonObject
        return root["items"]?.jsonArray.orEmpty().mapNotNull { el ->
            val obj = el.jsonObject
            val vid = obj["id"]?.jsonObject?.get("videoId")?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val snippet = obj["snippet"]?.jsonObject ?: return@mapNotNull null
            YouTubeVideoSummary(
                videoId = vid,
                title = snippet["title"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                channel = snippet["channelTitle"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            )
        }
    }

    override suspend fun listExistingVideoIds(videoIds: List<String>): Set<String> {
        val token = requireToken()
        val existing = mutableSetOf<String>()
        for (chunk in videoIds.distinct().chunked(50)) {
            val resp = try {
                httpClient.get("$baseUrl/videos") {
                    header(HttpHeaders.Authorization, "Bearer $token")
                    parameter("part", "id")
                    parameter("id", chunk.joinToString(","))
                    parameter("maxResults", 50)
                }
            } catch (t: Throwable) {
                throw YouTubeApiException(YouTubeFailure.NETWORK, t.message ?: "Network error")
            }
            val text = resp.bodyAsText()
            if (!resp.status.isSuccess()) throw mapError(resp.status.value, text)
            val root = json.parseToJsonElement(text).jsonObject
            for (item in root["items"]?.jsonArray.orEmpty()) {
                item.jsonObject["id"]?.jsonPrimitive?.contentOrNull?.let { existing += it }
            }
        }
        return existing
    }

    override suspend fun listPlaylistItems(playlistId: String): List<YouTubePlaylistItem> {
        val token = requireToken()
        val out = mutableListOf<YouTubePlaylistItem>()
        var pageToken: String? = null
        do {
            val resp = try {
                httpClient.get("$baseUrl/playlistItems") {
                    header(HttpHeaders.Authorization, "Bearer $token")
                    parameter("part", "snippet,contentDetails")
                    parameter("playlistId", playlistId)
                    parameter("maxResults", 50)
                    if (!pageToken.isNullOrBlank()) parameter("pageToken", pageToken)
                }
            } catch (t: Throwable) {
                throw YouTubeApiException(YouTubeFailure.NETWORK, t.message ?: "Network error")
            }
            val text = resp.bodyAsText()
            if (!resp.status.isSuccess()) throw mapError(resp.status.value, text)
            val root = json.parseToJsonElement(text).jsonObject
            for (el in root["items"]?.jsonArray.orEmpty()) {
                val obj = el.jsonObject
                val itemId = obj["id"]?.jsonPrimitive?.contentOrNull ?: continue
                val snippet = obj["snippet"]?.jsonObject
                val vid = obj["contentDetails"]?.jsonObject?.get("videoId")?.jsonPrimitive?.contentOrNull
                    ?: snippet?.get("resourceId")?.jsonObject?.get("videoId")?.jsonPrimitive?.contentOrNull
                    ?: continue
                out += YouTubePlaylistItem(
                    itemId = itemId,
                    videoId = vid,
                    title = snippet?.get("title")?.jsonPrimitive?.contentOrNull.orEmpty(),
                    channel = snippet?.get("videoOwnerChannelTitle")?.jsonPrimitive?.contentOrNull.orEmpty(),
                )
            }
            pageToken = root["nextPageToken"]?.jsonPrimitive?.contentOrNull
        } while (!pageToken.isNullOrBlank())
        return out
    }

    override suspend fun createPlaylist(title: String, description: String): String {
        val token = requireToken()
        val payload = buildJsonObject {
            putJsonObject("snippet") {
                put("title", title.ifBlank { "CrateSync Playlist" })
                put("description", description)
            }
            putJsonObject("status") {
                put("privacyStatus", "private")
            }
        }
        val resp = httpClient.post("$baseUrl/playlists") {
            header(HttpHeaders.Authorization, "Bearer $token")
            parameter("part", "snippet,status")
            contentType(ContentType.Application.Json)
            setBody(payload.toString())
        }
        val text = resp.bodyAsText()
        if (!resp.status.isSuccess()) throw mapError(resp.status.value, text)
        val root: JsonObject = json.parseToJsonElement(text).jsonObject
        return root["id"]?.jsonPrimitive?.contentOrNull
            ?: throw YouTubeApiException(YouTubeFailure.OTHER, "Missing created playlist ID.")
    }

    override suspend fun insertPlaylistItem(playlistId: String, videoId: String, position: Int?) {
        val token = requireToken()
        val payload = buildJsonObject {
            putJsonObject("snippet") {
                put("playlistId", playlistId)
                if (position != null) put("position", position)
                putJsonObject("resourceId") {
                    put("kind", "youtube#video")
                    put("videoId", videoId)
                }
            }
        }
        val resp = httpClient.post("$baseUrl/playlistItems") {
            header(HttpHeaders.Authorization, "Bearer $token")
            parameter("part", "snippet")
            contentType(ContentType.Application.Json)
            setBody(payload.toString())
        }
        val text = resp.bodyAsText()
        if (!resp.status.isSuccess()) throw mapError(resp.status.value, text)
    }

    override suspend fun deletePlaylistItem(itemId: String) {
        val token = requireToken()
        val resp = httpClient.delete("$baseUrl/playlistItems") {
            header(HttpHeaders.Authorization, "Bearer $token")
            parameter("id", itemId)
        }
        if (!resp.status.isSuccess()) throw mapError(resp.status.value, resp.bodyAsText())
    }

    override suspend fun movePlaylistItem(playlistId: String, itemId: String, videoId: String, position: Int) {
        val token = requireToken()
        val payload = buildJsonObject {
            put("id", itemId)
            putJsonObject("snippet") {
                put("playlistId", playlistId)
                put("position", position)
                putJsonObject("resourceId") {
                    put("kind", "youtube#video")
                    put("videoId", videoId)
                }
            }
        }
        val resp = httpClient.put("$baseUrl/playlistItems") {
            header(HttpHeaders.Authorization, "Bearer $token")
            parameter("part", "snippet")
            contentType(ContentType.Application.Json)
            setBody(payload.toString())
        }
        if (!resp.status.isSuccess()) throw mapError(resp.status.value, resp.bodyAsText())
    }
}
