package com.cratesync.core

import com.cratesync.model.LibraryTombstone
import com.cratesync.model.LocalTrack
import com.cratesync.model.Playlist
import com.cratesync.model.SmartPlaylist
import com.cratesync.model.SyncEvent
import kotlin.math.max

data class LibrarySnapshot(
    val tracks: List<LocalTrack>,
    val playlists: List<Playlist>,
    val smartPlaylists: List<SmartPlaylist>,
    val syncHistory: List<SyncEvent>,
    val tombstones: List<LibraryTombstone>,
)

data class CarriedOverCounts(
    val tracks: Int,
    val playlists: Int,
    val smartPlaylists: Int,
)

data class LibraryPushMergeResult(
    val library: LibrarySnapshot,
    val carriedOver: CarriedOverCounts,
    val revivedTrackIds: List<String>,
)

enum class TieBreaker { LOCAL, REMOTE }

/**
 * Multi-device conflict-free library merge with newest-edit wins and 365-day tombstones.
 */
object LibraryMerge {
    const val TOMBSTONE_MAX_AGE_MS = 365L * 24 * 60 * 60 * 1000
    const val SYNC_HISTORY_LIMIT = 50

    private fun sameEdits(a: LocalTrack, b: LocalTrack): Boolean =
        a.title == b.title &&
            a.artist == b.artist &&
            a.album == b.album &&
            a.genre == b.genre &&
            a.year == b.year &&
            a.trackNumber == b.trackNumber &&
            a.youtubeVideoId == b.youtubeVideoId &&
            a.youtubeTitle == b.youtubeTitle &&
            a.matchStatus == b.matchStatus

    fun stampEditedTracks(prev: List<LocalTrack>, next: List<LocalTrack>, now: Long): List<LocalTrack> {
        if (prev.isEmpty()) return next
        val prevById = prev.associateBy { it.id }
        return next.map { track ->
            val before = prevById[track.id] ?: return@map track
            if (before === track || before.updatedAt != track.updatedAt || sameEdits(before, track)) {
                track
            } else {
                track.copy(updatedAt = now)
            }
        }
    }

    fun stampEditedPlaylists(prev: List<Playlist>, next: List<Playlist>, now: Long): List<Playlist> {
        if (prev.isEmpty()) return next
        val prevById = prev.associateBy { it.id }
        return next.map { pl ->
            val before = prevById[pl.id] ?: return@map pl
            val unchanged = before.updatedAt != pl.updatedAt || (
                before.name == pl.name &&
                    before.description == pl.description &&
                    before.youtubePlaylistUrl == pl.youtubePlaylistUrl &&
                    before.watchedFolderName == pl.watchedFolderName &&
                    before.lastSyncedAt == pl.lastSyncedAt &&
                    before.syncRule == pl.syncRule &&
                    before.trackIds == pl.trackIds &&
                    before.syncedTrackIds == pl.syncedTrackIds
                )
            if (unchanged) pl else pl.copy(updatedAt = now)
        }
    }

    fun trackTombstone(track: LocalTrack, deletedAt: Long): LibraryTombstone.Track =
        LibraryTombstone.Track(
            id = track.id,
            fileKey = track.fileKey,
            driveFileId = track.driveFileId,
            deletedAt = deletedAt,
        )

    fun mergeLibraryTombstones(lists: List<List<LibraryTombstone>>, now: Long): List<LibraryTombstone> {
        val latest = LinkedHashMap<String, LibraryTombstone>()
        for (list in lists) {
            for (tomb in list) {
                if (now - tomb.deletedAt > TOMBSTONE_MAX_AGE_MS) continue
                val kind = when (tomb) {
                    is LibraryTombstone.Track -> "track"
                    is LibraryTombstone.PlaylistTombstone -> "playlist"
                    is LibraryTombstone.SmartPlaylistTombstone -> "smart-playlist"
                }
                val key = "$kind:${tomb.id}"
                val prev = latest[key]
                if (prev == null || tomb.deletedAt > prev.deletedAt) latest[key] = tomb
            }
        }
        return latest.values.toList()
    }

    private fun remoteEditWins(local: LocalTrack, remote: LocalTrack, onTie: TieBreaker): Boolean {
        val localAt = local.updatedAt ?: 0L
        val remoteAt = remote.updatedAt ?: 0L
        return remoteAt > localAt || (remoteAt == localAt && onTie == TieBreaker.REMOTE)
    }

    fun mergeTrackEdits(local: LocalTrack, remote: LocalTrack, onTie: TieBreaker): LocalTrack {
        if (!remoteEditWins(local, remote, onTie)) return local
        return local.copy(
            title = remote.title,
            artist = remote.artist,
            album = remote.album,
            genre = remote.genre,
            year = remote.year,
            trackNumber = remote.trackNumber,
            youtubeVideoId = remote.youtubeVideoId,
            youtubeTitle = remote.youtubeTitle,
            matchStatus = remote.matchStatus,
            updatedAt = remote.updatedAt,
        )
    }

    private fun <T> newestWins(
        local: List<T>,
        remote: List<T>,
        idOf: (T) -> String,
        updatedAtOf: (T) -> Long,
        onTie: TieBreaker,
    ): List<T> {
        val localIds = local.map(idOf).toSet()
        val remoteById = remote.associateBy(idOf)
        val remoteOnly = remote.filter { idOf(it) !in localIds }
        val merged = local.map { mine ->
            val theirs = remoteById[idOf(mine)] ?: return@map mine
            val mAt = updatedAtOf(mine)
            val tAt = updatedAtOf(theirs)
            when {
                tAt > mAt -> theirs
                tAt == mAt && onTie == TieBreaker.REMOTE -> theirs
                else -> mine
            }
        }
        return remoteOnly + merged
    }

    private class TombstoneIndex(tombstones: List<LibraryTombstone>) {
        private val trackById = mutableMapOf<String, Long>()
        private val trackByDriveId = mutableMapOf<String, Long>()
        private val trackByFileKey = mutableMapOf<String, Long>()
        private val others = mutableMapOf<String, Long>()

        init {
            fun keepLatest(map: MutableMap<String, Long>, key: String, at: Long) {
                val prev = map[key]
                if (prev == null || at > prev) map[key] = at
            }
            for (t in tombstones) {
                when (t) {
                    is LibraryTombstone.Track -> {
                        keepLatest(trackById, t.id, t.deletedAt)
                        keepLatest(trackByFileKey, t.fileKey.lowercase(), t.deletedAt)
                        if (!t.driveFileId.isNullOrBlank()) keepLatest(trackByDriveId, t.driveFileId, t.deletedAt)
                    }
                    is LibraryTombstone.PlaylistTombstone -> keepLatest(others, "playlist:${t.id}", t.deletedAt)
                    is LibraryTombstone.SmartPlaylistTombstone -> keepLatest(others, "smart-playlist:${t.id}", t.deletedAt)
                }
            }
        }

        fun isTrackDeleted(track: LocalTrack): Boolean {
            val matches = listOfNotNull(
                trackById[track.id],
                track.driveFileId?.let { trackByDriveId[it] },
                trackByFileKey[track.fileKey.lowercase()],
            )
            val deletedAt = matches.maxOrNull() ?: return false
            val clock = max(track.updatedAt ?: 0L, track.addedAt)
            return deletedAt >= clock
        }

        fun isDeleted(kind: String, id: String, updatedAt: Long): Boolean {
            val deletedAt = others["$kind:$id"] ?: return false
            return deletedAt >= updatedAt
        }
    }

    private fun buildTrackMatcher(local: List<LocalTrack>): (LocalTrack) -> LocalTrack? {
        val byDriveId = mutableMapOf<String, LocalTrack>()
        val byId = mutableMapOf<String, LocalTrack>()
        val byFileKey = mutableMapOf<String, LocalTrack>()
        val byNameSize = mutableMapOf<String, LocalTrack>()
        for (t in local) {
            if (!t.driveFileId.isNullOrBlank()) byDriveId[t.driveFileId] = t
            byId[t.id] = t
            byFileKey[t.fileKey.lowercase()] = t
            if (t.fileSize > 0L) byNameSize[nameSizeKey(t.fileName, t.fileSize)] = t
        }
        return { remote ->
            remote.driveFileId?.let { byDriveId[it] }
                ?: byId[remote.id]
                ?: byFileKey[remote.fileKey.lowercase()]
                ?: if (remote.fileSize > 0L) byNameSize[nameSizeKey(remote.fileName, remote.fileSize)] else null
        }
    }

    fun mergeLibraryForPush(
        local: LibrarySnapshot,
        remote: LibrarySnapshot?,
        holdsAudio: (LocalTrack) -> Boolean,
        now: Long,
    ): LibraryPushMergeResult {
        if (remote == null) {
            return LibraryPushMergeResult(
                library = local.copy(
                    syncHistory = local.syncHistory.take(SYNC_HISTORY_LIMIT),
                    tombstones = mergeLibraryTombstones(listOf(local.tombstones), now),
                ),
                carriedOver = CarriedOverCounts(0, 0, 0),
                revivedTrackIds = emptyList(),
            )
        }

        val tombstones = mergeLibraryTombstones(listOf(local.tombstones, remote.tombstones), now)
        val deleted = TombstoneIndex(tombstones)
        val findLocal = buildTrackMatcher(local.tracks)

        val remoteTwinByLocalId = mutableMapOf<String, LocalTrack>()
        val mergedIdByRemoteId = mutableMapOf<String, String>()
        val carriedTracks = mutableListOf<LocalTrack>()

        for (theirs in remote.tracks) {
            val mine = findLocal(theirs)
            if (mine != null) {
                mergedIdByRemoteId[theirs.id] = mine.id
                if (mine.id !in remoteTwinByLocalId) remoteTwinByLocalId[mine.id] = theirs
            } else if (!deleted.isTrackDeleted(theirs)) {
                mergedIdByRemoteId[theirs.id] = theirs.id
                carriedTracks += theirs
            }
        }

        val keptLocalTracks = mutableListOf<LocalTrack>()
        val revivedTrackIds = mutableListOf<String>()
        for (mine in local.tracks) {
            val theirs = remoteTwinByLocalId[mine.id]
            val settled = if (theirs != null) mergeTrackEdits(mine, theirs, TieBreaker.LOCAL) else mine
            if (!deleted.isTrackDeleted(settled)) {
                keptLocalTracks += settled
            } else if (holdsAudio(mine)) {
                keptLocalTracks += settled.copy(updatedAt = now)
                revivedTrackIds += mine.id
            }
        }

        val tracks = keptLocalTracks + carriedTracks
        val knownTrackIds = tracks.map { it.id }.toSet()
        fun uniqueKnown(ids: List<String>) = ids.filter { it in knownTrackIds }.distinct()

        val localPlaylists = local.playlists.map { pl ->
            pl.copy(trackIds = uniqueKnown(pl.trackIds), syncedTrackIds = uniqueKnown(pl.syncedTrackIds))
        }
        val remotePlaylists = remote.playlists.map { pl ->
            pl.copy(
                trackIds = uniqueKnown(pl.trackIds.map { mergedIdByRemoteId[it] ?: it }),
                syncedTrackIds = uniqueKnown(pl.syncedTrackIds.map { mergedIdByRemoteId[it] ?: it }),
            )
        }
        val playlists = newestWins(localPlaylists, remotePlaylists, { it.id }, { it.updatedAt }, TieBreaker.LOCAL)
            .filterNot { deleted.isDeleted("playlist", it.id, it.updatedAt) }
        val smartPlaylists = newestWins(local.smartPlaylists, remote.smartPlaylists, { it.id }, { it.updatedAt }, TieBreaker.LOCAL)
            .filterNot { deleted.isDeleted("smart-playlist", it.id, it.updatedAt) }

        val history = (local.syncHistory + remote.syncHistory)
            .associateBy { it.id }
            .values
            .sortedByDescending { it.timestamp }
            .take(SYNC_HISTORY_LIMIT)

        val localPlIds = local.playlists.map { it.id }.toSet()
        val localSmIds = local.smartPlaylists.map { it.id }.toSet()

        return LibraryPushMergeResult(
            library = LibrarySnapshot(tracks, playlists, smartPlaylists, history, tombstones),
            carriedOver = CarriedOverCounts(
                tracks = carriedTracks.size,
                playlists = playlists.count { it.id !in localPlIds },
                smartPlaylists = smartPlaylists.count { it.id !in localSmIds },
            ),
            revivedTrackIds = revivedTrackIds,
        )
    }

    fun dropTombstoned(
        tracks: List<LocalTrack>,
        playlists: List<Playlist>,
        smartPlaylists: List<SmartPlaylist>,
        tombstones: List<LibraryTombstone>,
        holdsAudio: (LocalTrack) -> Boolean,
        now: Long,
    ): Triple<List<LocalTrack>, List<Playlist>, List<SmartPlaylist>> {
        val deleted = TombstoneIndex(tombstones)
        val removedIds = mutableSetOf<String>()
        val keptTracks = buildList {
            for (track in tracks) {
                if (!deleted.isTrackDeleted(track)) add(track)
                else if (holdsAudio(track)) add(track.copy(updatedAt = now))
                else removedIds += track.id
            }
        }
        val keptPlaylists = playlists
            .filterNot { deleted.isDeleted("playlist", it.id, it.updatedAt) }
            .map { pl ->
                if (removedIds.isEmpty()) pl
                else pl.copy(
                    trackIds = pl.trackIds.filterNot { it in removedIds },
                    syncedTrackIds = pl.syncedTrackIds.filterNot { it in removedIds },
                )
            }
        val keptSmart = smartPlaylists.filterNot { deleted.isDeleted("smart-playlist", it.id, it.updatedAt) }
        return Triple(keptTracks, keptPlaylists, keptSmart)
    }

    fun reviveTombstoned(
        tracks: List<LocalTrack>,
        playlists: List<Playlist>,
        smartPlaylists: List<SmartPlaylist>,
        tombstones: List<LibraryTombstone>,
        now: Long,
    ): Triple<List<LocalTrack>, List<Playlist>, List<SmartPlaylist>> {
        if (tombstones.isEmpty()) return Triple(tracks, playlists, smartPlaylists)
        val deleted = TombstoneIndex(tombstones)
        return Triple(
            tracks.map { if (deleted.isTrackDeleted(it)) it.copy(updatedAt = now) else it },
            playlists.map { if (deleted.isDeleted("playlist", it.id, it.updatedAt)) it.copy(updatedAt = now) else it },
            smartPlaylists.map { if (deleted.isDeleted("smart-playlist", it.id, it.updatedAt)) it.copy(updatedAt = now) else it },
        )
    }
}
