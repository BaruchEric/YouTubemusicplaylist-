package com.cratesync.youtube

import com.cratesync.model.LocalTrack
import com.cratesync.model.Playlist
import com.cratesync.model.YouTubePushRecord
import kotlinx.coroutines.delay
import kotlin.math.ceil
import kotlin.math.max

data class YouTubePushPlan(
    val toInsert: List<String>,
    val toDelete: List<YouTubePlaylistItem>,
    val alreadyThere: Int,
    val leftAlone: Int,
)

data class YouTubeOrderPlan(
    val stays: List<String>,
    val moves: List<String>,
)

data class YouTubePushEstimate(
    val linkedPlaylistId: String?,
    val knowsWhatIsThere: Boolean,
    val matchedCount: Int,
    val sendCount: Int,
    val removeCount: Int,
    val moveCount: Int,
    val unmatchedCount: Int,
    val quotaUnits: Int,
    val days: Int,
)

sealed class YouTubeSongOrder {
    data object InOrder : YouTubeSongOrder()
    data class OutOfOrder(val left: Int) : YouTubeSongOrder()
    data object SortedByYouTube : YouTubeSongOrder()
}

data class YouTubePushOutcome(
    val playlistId: String?,
    val created: Boolean,
    val inserted: List<String>,
    val removed: List<String>,
    val moved: List<String>,
    val order: YouTubeSongOrder,
    val alreadyThere: Int,
    val leftAlone: Int,
    val unavailable: List<String>,
    val notSent: Int,
    val onYouTube: List<String>,
    val stoppedMessage: String? = null,
    val record: YouTubePushRecord? = null,
)

/**
 * 3-pass ordered YouTube playlist push engine (Insert -> Safe Delete -> LIS Optimal Move).
 * Never removes or moves songs added manually on YouTube outside CrateSync.
 */
object YouTubePush {
    const val YOUTUBE_DAILY_QUOTA_UNITS = 10_000
    const val YOUTUBE_WRITE_COST_UNITS = 50

    fun playlistVideoIds(tracks: List<LocalTrack>): Pair<List<String>, Int> {
        val seen = linkedSetOf<String>()
        var unmatched = 0
        for (t in tracks) {
            if (!t.youtubeVideoId.isNullOrBlank()) seen += t.youtubeVideoId else unmatched++
        }
        return seen.toList() to unmatched
    }

    fun planPush(
        wanted: List<String>,
        remote: List<YouTubePlaylistItem>,
        previouslyPushed: List<String>,
    ): YouTubePushPlan {
        val wantedSet = wanted.toSet()
        val pushedSet = previouslyPushed.toSet()
        val remoteVideos = remote.map { it.videoId }.toSet()
        val unwanted = remote.filter { it.videoId !in wantedSet }
        val toDelete = unwanted.filter { it.videoId in pushedSet }
        val toInsert = wanted.filter { it !in remoteVideos }
        val leftAlone = unwanted.filter { it.videoId !in pushedSet }.map { it.videoId }.toSet().size
        return YouTubePushPlan(toInsert, toDelete, wanted.size - toInsert.size, leftAlone)
    }

    fun planOrder(wanted: List<String>, remote: List<String>): YouTubeOrderPlan {
        val placeInPlaylist = wanted.withIndex().associate { it.value to it.index }
        val onYt = mutableSetOf<String>()
        val places = mutableListOf<Int>()
        for (vid in remote) {
            val place = placeInPlaylist[vid] ?: continue
            if (onYt.add(vid)) places += place
        }
        // Longest Increasing Subsequence (LIS) minimizes quota-expensive YouTube move calls
        val lastOfRun = mutableListOf<Int>()
        val before = IntArray(places.size) { -1 }
        for (i in places.indices) {
            val place = places[i]
            var lo = 0
            var hi = lastOfRun.size
            while (lo < hi) {
                val mid = (lo + hi) ushr 1
                if (places[lastOfRun[mid]] < place) lo = mid + 1 else hi = mid
            }
            before[i] = if (lo > 0) lastOfRun[lo - 1] else -1
            if (lo == lastOfRun.size) lastOfRun.add(i) else lastOfRun[lo] = i
        }
        val staying = mutableSetOf<Int>()
        var cur = lastOfRun.lastOrNull() ?: -1
        while (cur != -1) {
            staying += places[cur]
            cur = before[cur]
        }
        val stays = mutableListOf<String>()
        val moves = mutableListOf<String>()
        wanted.forEachIndexed { idx, vid ->
            if (vid in onYt && placeInPlaylist[vid] == idx) {
                if (idx in staying) stays += vid else moves += vid
            }
        }
        return YouTubeOrderPlan(stays, moves)
    }

    fun estimate(playlist: Playlist, tracks: List<LocalTrack>): YouTubePushEstimate {
        val (videoIds, unmatched) = playlistVideoIds(tracks)
        val linkedId = YouTubeLinks.extractPlaylistId(playlist.youtubePlaylistUrl)
        val pushed = playlist.youtubePush?.takeIf { linkedId != null && it.playlistId == linkedId }?.videoIds
        val pushedSet = pushed.orEmpty().toSet()
        val wantedSet = videoIds.toSet()
        val sendCount = videoIds.count { it !in pushedSet }
        val removeCount = pushed.orEmpty().count { it !in wantedSet }
        val moveCount = planOrder(videoIds, pushed.orEmpty()).moves.size
        val writes = sendCount + removeCount + moveCount + if (linkedId == null) 1 else 0
        val quota = writes * YOUTUBE_WRITE_COST_UNITS
        val days = max(1, ceil(quota.toDouble() / YOUTUBE_DAILY_QUOTA_UNITS).toInt())
        return YouTubePushEstimate(
            linkedPlaylistId = linkedId,
            knowsWhatIsThere = pushed != null,
            matchedCount = videoIds.size,
            sendCount = sendCount,
            removeCount = removeCount,
            moveCount = moveCount,
            unmatchedCount = unmatched,
            quotaUnits = quota,
            days = days,
        )
    }

    private data class PicturedEntry(val itemId: String?, val videoId: String)

    private fun placeFor(
        entries: List<PicturedEntry>,
        wanted: List<String>,
        videoId: String,
        inPlace: Set<String>,
    ): Int {
        val at = wanted.indexOf(videoId)
        for (i in at - 1 downTo 0) {
            if (wanted[i] !in inPlace) continue
            val idx = entries.indexOfFirst { it.videoId == wanted[i] }
            if (idx != -1) return idx + 1
        }
        for (i in at + 1 until wanted.size) {
            if (wanted[i] !in inPlace) continue
            val idx = entries.indexOfFirst { it.videoId == wanted[i] }
            if (idx != -1) return idx
        }
        return entries.size
    }

    private suspend fun writeOnce(op: suspend () -> Unit): YouTubeFailure? {
        try {
            op()
            return null
        } catch (e: YouTubeApiException) {
            if (e.failure != YouTubeFailure.BUSY) return e.failure
        } catch (_: Throwable) {
            return YouTubeFailure.OTHER
        }
        delay(2000L)
        return try {
            op()
            null
        } catch (e: YouTubeApiException) {
            e.failure
        } catch (_: Throwable) {
            YouTubeFailure.OTHER
        }
    }

    suspend fun push(
        api: YouTubeApi,
        playlist: Playlist,
        tracks: List<LocalTrack>,
        now: Long,
        onStatus: (String) -> Unit = {},
    ): YouTubePushOutcome {
        val (wanted, _) = playlistVideoIds(tracks)
        val linkedId = YouTubeLinks.extractPlaylistId(playlist.youtubePlaylistUrl)
        var created = false
        val remote: List<YouTubePlaylistItem>
        val playlistId: String

        try {
            if (linkedId != null) {
                onStatus("Reading remote YouTube playlist…")
                remote = api.listPlaylistItems(linkedId)
                playlistId = linkedId
            } else {
                onStatus("Creating private YouTube playlist…")
                playlistId = api.createPlaylist(playlist.name, playlist.description)
                created = true
                remote = emptyList()
            }
        } catch (e: YouTubeApiException) {
            return YouTubePushOutcome(
                playlistId = linkedId,
                created = false,
                inserted = emptyList(),
                removed = emptyList(),
                moved = emptyList(),
                order = YouTubeSongOrder.InOrder,
                alreadyThere = 0,
                leftAlone = 0,
                unavailable = emptyList(),
                notSent = wanted.size,
                onYouTube = emptyList(),
                stoppedMessage = e.message,
            )
        }

        val previouslyPushed = playlist.youtubePush?.takeIf { it.playlistId == linkedId }?.videoIds.orEmpty()
        val plan = planPush(wanted, remote, previouslyPushed)
        val entries = remote.map { PicturedEntry(it.itemId, it.videoId) }.toMutableList()
        val orderPlan = planOrder(wanted, remote.map { it.videoId })
        val inPlace = orderPlan.stays.toMutableSet()

        val inserted = mutableListOf<String>()
        val removed = mutableListOf<String>()
        val moved = mutableListOf<String>()
        val unavailable = mutableListOf<String>()
        var placing = true
        var sortedByYt = false
        var stoppedMsg: String? = null
        var notSent = plan.toInsert.size

        fun refusedPlace(f: YouTubeFailure?): Boolean {
            if (f != YouTubeFailure.NOT_MANUAL_ORDER && f != YouTubeFailure.BAD_POSITION) return false
            placing = false
            if (f == YouTubeFailure.NOT_MANUAL_ORDER) sortedByYt = true
            return true
        }

        // Pass 1: Insert missing videos
        for (vid in plan.toInsert) {
            var pos: Int? = if (placing) placeFor(entries, wanted, vid, inPlace) else null
            var fail = writeOnce { api.insertPlaylistItem(playlistId, vid, pos) }
            if (pos != null && refusedPlace(fail)) {
                pos = null
                fail = writeOnce { api.insertPlaylistItem(playlistId, vid, null) }
            }
            when {
                fail == YouTubeFailure.VIDEO_MISSING -> unavailable += vid
                fail != null -> { stoppedMsg = describeYouTubeFailure(fail); break }
                else -> {
                    inserted += vid
                    if (pos == null) entries += PicturedEntry(null, vid)
                    else { entries.add(pos, PicturedEntry(null, vid)); inPlace += vid }
                }
            }
            notSent--
            onStatus("Adding songs (${inserted.size + unavailable.size}/${plan.toInsert.size})…")
        }

        // Pass 2: Delete videos CrateSync previously pushed that left the playlist
        if (stoppedMsg == null) {
            for (item in plan.toDelete) {
                val fail = writeOnce { api.deletePlaylistItem(item.itemId) }
                if (fail != null && fail != YouTubeFailure.ITEM_MISSING) {
                    stoppedMsg = describeYouTubeFailure(fail)
                    break
                }
                entries.removeAll { it.itemId == item.itemId }
                if (item.videoId !in removed) removed += item.videoId
                onStatus("Removing deleted songs (${removed.size}/${plan.toDelete.size})…")
            }
        }

        // Pass 3: Reorder remaining out-of-order videos
        if (stoppedMsg == null && placing) {
            for (vid in orderPlan.moves) {
                val from = entries.indexOfFirst { it.videoId == vid }
                val entry = entries.getOrNull(from) ?: continue
                val itemId = entry.itemId ?: continue
                entries.removeAt(from)
                val pos = placeFor(entries, wanted, vid, inPlace)
                val fail = writeOnce { api.movePlaylistItem(playlistId, itemId, vid, pos) }
                when {
                    fail == YouTubeFailure.ITEM_MISSING -> Unit
                    fail != null -> {
                        entries.add(from, entry)
                        if (!refusedPlace(fail)) stoppedMsg = describeYouTubeFailure(fail)
                        break
                    }
                    else -> {
                        entries.add(pos, entry)
                        inPlace += vid
                        moved += vid
                    }
                }
                onStatus("Ordering songs (${moved.size}/${orderPlan.moves.size})…")
            }
        }

        val videosNow = entries.map { it.videoId }
        val wantedSet = wanted.toSet()
        val onYouTube = videosNow.filter { it in wantedSet }.distinct()
        val leftToMove = planOrder(wanted, videosNow).moves.size
        val order = when {
            sortedByYt -> YouTubeSongOrder.SortedByYouTube
            leftToMove > 0 -> YouTubeSongOrder.OutOfOrder(leftToMove)
            else -> YouTubeSongOrder.InOrder
        }
        val remoteVideoSet = remote.map { it.videoId }.toSet()
        val removedSet = removed.toSet()
        val pushedAndThere = (previouslyPushed.filter { it in remoteVideoSet && it !in removedSet } + inserted).toSet()
        val record = YouTubePushRecord(
            playlistId = playlistId,
            videoIds = videosNow.filter { it in pushedAndThere }.distinct(),
            pushedAt = now,
        )
        return YouTubePushOutcome(
            playlistId = playlistId,
            created = created,
            inserted = inserted,
            removed = removed,
            moved = moved,
            order = order,
            alreadyThere = plan.alreadyThere,
            leftAlone = plan.leftAlone,
            unavailable = unavailable,
            notSent = notSent,
            onYouTube = onYouTube,
            stoppedMessage = stoppedMsg,
            record = record,
        )
    }

    fun applyOutcomeToPlaylist(
        playlist: Playlist,
        outcome: YouTubePushOutcome,
        now: Long,
        library: Map<String, LocalTrack>,
    ): Playlist {
        val record = outcome.record ?: return playlist
        val onYt = outcome.onYouTube.toSet()
        val removed = outcome.removed.toSet()
        val wasSynced = playlist.syncedTrackIds.toSet()
        val inPlaylist = playlist.trackIds.toSet()

        fun holds(set: Set<String>, id: String): Boolean {
            val vid = library[id]?.youtubeVideoId ?: return false
            return vid in set
        }
        val synced = playlist.trackIds.filter { it in wasSynced || holds(onYt, it) }.toMutableList()
        if (outcome.stoppedMessage != null) {
            synced += playlist.syncedTrackIds.filter { it !in inPlaylist && !holds(removed, it) }
        }
        return playlist.copy(
            youtubePlaylistUrl = if (outcome.created && outcome.playlistId != null) {
                YouTubeLinks.buildYouTubeMusicPlaylistUrl(outcome.playlistId)
            } else {
                playlist.youtubePlaylistUrl
            },
            youtubePush = record,
            syncedTrackIds = synced.distinct(),
            lastSyncedAt = if (outcome.stoppedMessage == null) now else playlist.lastSyncedAt,
            updatedAt = now,
        )
    }
}
