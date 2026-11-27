package com.cratesync.core

import com.cratesync.model.LocalTrack

data class ScannedFile(
    val name: String,
    val size: Long,
    val relativePath: String,
)

sealed class ScanMatchResult {
    data class Known(val track: LocalTrack) : ScanMatchResult()
    data class DriveCopy(val track: LocalTrack) : ScanMatchResult()
    data object New : ScanMatchResult()
}

/**
 * Resolves each scanned local file against the catalog using NFC-folded paths and sizes,
 * linking Google Drive stubs to their newly discovered local files without creating duplicates.
 */
class ScanMatcher(
    tracks: List<LocalTrack>,
    private val hasAudioOnDevice: (String) -> Boolean,
) {
    private val byKey = mutableMapOf<String, LocalTrack>()
    private val byPathSize = mutableMapOf<String, LocalTrack>()
    private val byNameSize = mutableMapOf<String, MutableList<LocalTrack>>()
    private val taken = mutableSetOf<String>()

    init {
        for (track in tracks) {
            byKey[track.fileKey] = track
            if (track.fileSize <= 0L) continue
            byPathSize[pathSizeKey(track.relativePath, track.fileSize)] = track
            byNameSize.getOrPut(nameSizeKey(track.fileName, track.fileSize)) { mutableListOf() }.add(track)
        }
    }

    fun match(file: ScannedFile): ScanMatchResult {
        val exact = byKey["${file.relativePath.lowercase()}::${file.size}"]
            ?: byPathSize[pathSizeKey(file.relativePath, file.size)]
        if (exact != null) return ScanMatchResult.Known(exact)
        if (file.size <= 0L) return ScanMatchResult.New

        val candidates = byNameSize[nameSizeKey(file.name, file.size)].orEmpty()
        var bestDriveSong: LocalTrack? = null
        var bestScore = -1
        for (candidate in candidates) {
            if (candidate.id in taken || !isAtDrivePath(candidate)) continue
            val score = sharedParentFolders(candidate.relativePath, file.relativePath)
            if (score > bestScore) {
                bestDriveSong = candidate
                bestScore = score
            }
        }
        val isLoose = !file.relativePath.contains('/')
        if (bestDriveSong != null) {
            taken += bestDriveSong.id
            return if (isLoose) ScanMatchResult.Known(bestDriveSong) else ScanMatchResult.DriveCopy(bestDriveSong)
        }
        if (isLoose) {
            val orphan = candidates.firstOrNull { candidate ->
                candidate.id !in taken && (candidate.isMissingOnDevice || !hasAudioOnDevice(candidate.fileKey))
            }
            if (orphan != null) return ScanMatchResult.Known(orphan)
        }
        return ScanMatchResult.New
    }

    private fun isAtDrivePath(track: LocalTrack): Boolean {
        if (track.driveFileId.isNullOrBlank() || track.drivePath.isNullOrBlank()) return false
        return foldFileName(track.relativePath) == foldFileName("${track.drivePath}/${track.fileName}")
    }

    private fun sharedParentFolders(a: String, b: String): Int {
        val left = foldFileName(a).split('/').dropLast(1).reversed()
        val right = foldFileName(b).split('/').dropLast(1).reversed()
        var shared = 0
        while (shared < left.size && shared < right.size && left[shared] == right[shared]) shared++
        return shared
    }
}

fun linkDriveSongToLocalFile(track: LocalTrack, file: ScannedFile): LocalTrack {
    val segments = file.relativePath.split('/').filter { it.isNotEmpty() }
    return track.copy(
        relativePath = file.relativePath,
        folderName = if (segments.size > 1) segments.first() else track.folderName,
        isMissingOnDevice = false,
    )
}
