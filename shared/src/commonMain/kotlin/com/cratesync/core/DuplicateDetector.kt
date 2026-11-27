package com.cratesync.core

import com.cratesync.model.LocalTrack
import com.cratesync.model.Playlist

enum class DuplicateMatchKind { CONTENT_HASH, EXACT_METADATA }

data class DuplicateGroup(
    val key: String,
    val kind: DuplicateMatchKind,
    val keeper: LocalTrack,
    val duplicates: List<LocalTrack>,
    val reclaimableBytes: Long,
)

data class DuplicateRemovalResult(
    val remainingTracks: List<LocalTrack>,
    val updatedPlaylists: List<Playlist>,
    val removedTracks: List<LocalTrack>,
    val remappedReferences: Int,
)

/**
 * Groups duplicate songs by SHA-256 content hash or normalized metadata + duration,
 * selects the highest-quality keeper, and remaps playlist references cleanly on removal.
 */
object DuplicateDetector {
    private val LOSSLESS = setOf("FLAC", "WAV", "AIFF", "AIF", "ALAC")

    fun scoreKeeper(track: LocalTrack): Int {
        var score = 0
        if (!track.isMissingOnDevice) score += 40
        if (track.format.uppercase() in LOSSLESS) score += 25
        if (track.youtubeVideoId != null) score += 20
        if (track.driveFileId != null) score += 15
        if (!track.coverArtUrl.isNullOrBlank()) score += 10
        if (!track.genre.isNullOrBlank()) score += 6
        if (track.year.isNotBlank()) score += 4
        score += (track.playCount ?: 0).coerceAtMost(10)
        return score
    }

    fun findDuplicateGroups(tracks: List<LocalTrack>): List<DuplicateGroup> {
        val groups = mutableListOf<DuplicateGroup>()
        val claimedIds = mutableSetOf<String>()

        // 1. Exact SHA-256 content hash duplicates
        tracks.filter { !it.contentHash.isNullOrBlank() }
            .groupBy { it.contentHash!! }
            .filterValues { it.size > 1 }
            .forEach { (hash, members) ->
                val sorted = members.sortedWith(
                    compareByDescending<LocalTrack> { scoreKeeper(it) }
                        .thenByDescending { it.fileSize }
                        .thenBy { it.addedAt }
                )
                val keeper = sorted.first()
                val dups = sorted.drop(1)
                claimedIds += members.map { it.id }
                groups += DuplicateGroup(
                    key = "hash:$hash",
                    kind = DuplicateMatchKind.CONTENT_HASH,
                    keeper = keeper,
                    duplicates = dups,
                    reclaimableBytes = dups.sumOf { it.fileSize },
                )
            }

        // 2. Normalized Title + Artist + Duration (~2s bucket) duplicates
        tracks.filter { it.id !in claimedIds }
            .groupBy { t ->
                val title = foldFileName(t.title).trim()
                val artist = foldFileName(t.artist).trim()
                val durBucket = (t.duration / 2.0).toInt()
                "$artist::$title::$durBucket"
            }
            .filter { (key, members) -> !key.startsWith("unknown artist::") && members.size > 1 }
            .forEach { (metaKey, members) ->
                val sorted = members.sortedWith(
                    compareByDescending<LocalTrack> { scoreKeeper(it) }
                        .thenByDescending { it.fileSize }
                        .thenBy { it.addedAt }
                )
                val keeper = sorted.first()
                val dups = sorted.drop(1)
                groups += DuplicateGroup(
                    key = "meta:$metaKey",
                    kind = DuplicateMatchKind.EXACT_METADATA,
                    keeper = keeper,
                    duplicates = dups,
                    reclaimableBytes = dups.sumOf { it.fileSize },
                )
            }

        return groups.sortedByDescending { it.reclaimableBytes }
    }

    fun removeDuplicatesWithRemap(
        tracks: List<LocalTrack>,
        playlists: List<Playlist>,
        duplicateToKeeperId: Map<String, String>,
        now: Long,
    ): DuplicateRemovalResult {
        if (duplicateToKeeperId.isEmpty()) {
            return DuplicateRemovalResult(tracks, playlists, emptyList(), 0)
        }
        val toRemoveIds = duplicateToKeeperId.keys
        val removedTracks = tracks.filter { it.id in toRemoveIds }
        val remainingTracks = tracks.filterNot { it.id in toRemoveIds }

        var remappedCount = 0
        val updatedPlaylists = playlists.map { pl ->
            var changed = false
            val remappedIds = buildList {
                val seen = mutableSetOf<String>()
                for (id in pl.trackIds) {
                    val mapped = duplicateToKeeperId[id] ?: id
                    if (mapped != id) {
                        remappedCount++
                        changed = true
                    }
                    if (seen.add(mapped)) add(mapped)
                }
            }
            val remappedSynced = pl.syncedTrackIds.map { duplicateToKeeperId[it] ?: it }.distinct()
            if (changed || remappedIds != pl.trackIds) {
                pl.copy(trackIds = remappedIds, syncedTrackIds = remappedSynced, updatedAt = now)
            } else {
                pl
            }
        }
        return DuplicateRemovalResult(remainingTracks, updatedPlaylists, removedTracks, remappedCount)
    }
}
