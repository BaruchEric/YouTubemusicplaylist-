package com.cratesync.core

import com.cratesync.model.LocalTrack
import com.cratesync.model.Playlist
import com.cratesync.model.PlaylistDiff
import com.cratesync.model.SyncEvent
import com.cratesync.platform.randomUuid
import com.cratesync.youtube.YouTubeLinks

data class ImportedTrackSeed(
    val title: String,
    val artist: String = "Unknown Artist",
    val album: String = "Unknown Album",
    val youtubeVideoId: String? = null,
)

/**
 * Computes playlist diffs, applies sync rules, and handles M3U8/CSV/TXT/JSON import and export.
 */
object SyncEngine {

    fun computePlaylistDiff(playlist: Playlist, trackById: Map<String, LocalTrack>): PlaylistDiff {
        val currentIds = playlist.trackIds.toSet()
        val syncedIds = playlist.syncedTrackIds.toSet()

        val toAdd = playlist.trackIds
            .filter { it !in syncedIds }
            .mapNotNull { trackById[it] }
        val toRemove = playlist.syncedTrackIds
            .filter { it !in currentIds }
            .mapNotNull { trackById[it] }
        val currentTracks = playlist.trackIds.mapNotNull { trackById[it] }
        val missingOnDevice = currentTracks.filter { it.isMissingOnDevice }
        val matchedCount = currentTracks.count { !it.youtubeVideoId.isNullOrBlank() }
        val unmatchedCount = currentTracks.size - matchedCount

        return PlaylistDiff(
            playlistId = playlist.id,
            toAdd = toAdd,
            toRemove = toRemove,
            missingOnDevice = missingOnDevice,
            unmatchedCount = unmatchedCount,
            matchedCount = matchedCount,
            hasChanges = toAdd.isNotEmpty() || toRemove.isNotEmpty(),
        )
    }

    fun applySyncRulesToPlaylists(
        playlists: List<Playlist>,
        tracks: List<LocalTrack>,
        now: Long,
    ): List<Playlist> {
        val byId = tracks.associateBy { it.id }
        return playlists.map { pl ->
            var ids = pl.trackIds.toMutableList()
            var changed = false

            if (pl.syncRule.removeMissingFiles) {
                val filtered = ids.filter { id -> byId[id]?.isMissingOnDevice != true }
                if (filtered.size != ids.size) {
                    ids = filtered.toMutableList()
                    changed = true
                }
            }
            if (pl.syncRule.autoAddNewFiles) {
                val filter = pl.syncRule.folderFilter.trim().lowercase()
                val watched = pl.watchedFolderName?.trim()?.lowercase().orEmpty()
                val existing = ids.toSet()
                for (track in tracks) {
                    if (track.id in existing || track.isMissingOnDevice) continue
                    val folderMatches = when {
                        filter.isNotEmpty() -> track.relativePath.lowercase().contains(filter) ||
                            track.folderName.lowercase().contains(filter)
                        watched.isNotEmpty() -> track.folderName.equals(watched, ignoreCase = true)
                        else -> true
                    }
                    if (folderMatches) {
                        ids += track.id
                        changed = true
                    }
                }
            }
            if (changed) pl.copy(trackIds = ids, updatedAt = now) else pl
        }
    }

    fun createSyncEvent(playlist: Playlist, diff: PlaylistDiff, now: Long): SyncEvent {
        val summary = buildString {
            append("+${diff.toAdd.size} added, -${diff.toRemove.size} removed")
            append(" (${diff.matchedCount}/${playlist.trackIds.size} YT matched)")
        }
        return SyncEvent(
            id = randomUuid(),
            playlistId = playlist.id,
            playlistName = playlist.name,
            timestamp = now,
            addedCount = diff.toAdd.size,
            removedCount = diff.toRemove.size,
            matchedCount = diff.matchedCount,
            totalTracks = playlist.trackIds.size,
            summary = summary,
        )
    }

    fun exportM3u8(playlist: Playlist, tracks: List<LocalTrack>): String = buildString {
        appendLine("#EXTM3U")
        appendLine("#PLAYLIST:${playlist.name}")
        for (track in tracks) {
            appendLine("#EXTINF:${track.duration.toInt()},${track.artist} - ${track.title}")
            appendLine(track.relativePath)
        }
    }

    fun exportCsv(tracks: List<LocalTrack>): String = buildString {
        appendLine("Title,Artist,Album,Year,Genre,Format,DurationSec,YouTubeVideoId,RelativePath")
        for (t in tracks) {
            val cols = listOf(
                t.title, t.artist, t.album, t.year, t.genre.orEmpty(),
                t.format, t.duration.toInt().toString(), t.youtubeVideoId.orEmpty(), t.relativePath
            ).map { "\"${it.replace("\"", "\"\"")}\"" }
            appendLine(cols.joinToString(","))
        }
    }

    fun parseImportedText(raw: String): List<ImportedTrackSeed> {
        val lines = raw.lines().map { it.trim() }.filter { it.isNotEmpty() }
        if (lines.isEmpty()) return emptyList()
        val seeds = mutableListOf<ImportedTrackSeed>()
        var pendingExtInf: Pair<String, String>? = null

        for (line in lines) {
            if (line.startsWith("#EXTM3U", ignoreCase = true) || line.startsWith("#PLAYLIST:", ignoreCase = true)) {
                continue
            }
            if (line.startsWith("#EXTINF:", ignoreCase = true)) {
                val info = line.substringAfter(',', "").trim()
                val parts = info.split(Regex("\\s+[-–—]\\s+"), limit = 2)
                pendingExtInf = if (parts.size == 2) parts[0].trim() to parts[1].trim() else "Unknown Artist" to info
                continue
            }
            if (line.startsWith("#")) continue

            val videoId = YouTubeLinks.extractVideoId(line)
            if (pendingExtInf != null) {
                seeds += ImportedTrackSeed(
                    title = pendingExtInf.second.ifBlank { line },
                    artist = pendingExtInf.first.ifBlank { "Unknown Artist" },
                    youtubeVideoId = videoId,
                )
                pendingExtInf = null
                continue
            }

            // Tab or pipe or "Artist - Title" line with optional YouTube link
            val withoutUrl = line.replace(Regex("https?://\\S+"), "").trim(' ', '-', '|', ',', '\t')
            val dashParts = withoutUrl.split(Regex("\\s+[-–—]\\s+"), limit = 2)
            if (dashParts.size == 2) {
                seeds += ImportedTrackSeed(
                    artist = dashParts[0].trim(),
                    title = dashParts[1].trim(),
                    youtubeVideoId = videoId,
                )
            } else if (withoutUrl.isNotEmpty() || videoId != null) {
                seeds += ImportedTrackSeed(
                    title = withoutUrl.ifBlank { videoId ?: line },
                    youtubeVideoId = videoId,
                )
            }
        }
        return seeds
    }
}
