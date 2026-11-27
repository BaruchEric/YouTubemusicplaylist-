package com.cratesync.youtube

import com.cratesync.model.LocalTrack
import com.cratesync.model.MatchStatus
import com.cratesync.model.YouTubeCheckStamp

data class MatchRefreshOutcome(
    val confirmed: Set<String> = emptySet(),
    val gone: Set<String> = emptySet(),
    val failure: YouTubeFailure? = null,
)

/**
 * Enforces YouTube API Services 30-day data freshness policy by checking saved video IDs
 * via videos.list (1 quota unit per 50 videos) and unmatching deleted/private videos.
 */
object MatchRefresh {
    const val MATCH_REFRESH_MS = 30L * 24 * 60 * 60 * 1000

    fun matchesDueForRefresh(tracks: List<LocalTrack>, now: Long): List<LocalTrack> =
        tracks.filter { track ->
            val vid = track.youtubeVideoId ?: return@filter false
            val checked = track.youtubeChecked
            checked == null || checked.videoId != vid || (now - checked.at >= MATCH_REFRESH_MS)
        }

    suspend fun refreshMatches(api: YouTubeApi, tracks: List<LocalTrack>, now: Long): MatchRefreshOutcome {
        val due = matchesDueForRefresh(tracks, now).mapNotNull { it.youtubeVideoId }.toSet()
        if (due.isEmpty()) return MatchRefreshOutcome()
        return try {
            val confirmed = api.listExistingVideoIds(due.toList())
            val gone = due - confirmed
            MatchRefreshOutcome(confirmed, gone, null)
        } catch (e: YouTubeApiException) {
            MatchRefreshOutcome(failure = e.failure)
        } catch (_: Throwable) {
            MatchRefreshOutcome(failure = YouTubeFailure.OTHER)
        }
    }

    fun applyRefresh(
        tracks: List<LocalTrack>,
        outcome: MatchRefreshOutcome,
        now: Long,
    ): Pair<List<LocalTrack>, Int> {
        if (outcome.confirmed.isEmpty() && outcome.gone.isEmpty()) return tracks to 0
        var cleared = 0
        val next = tracks.map { track ->
            val vid = track.youtubeVideoId ?: return@map track
            when (vid) {
                in outcome.gone -> {
                    cleared++
                    track.copy(
                        youtubeVideoId = null,
                        youtubeTitle = null,
                        matchStatus = MatchStatus.UNMATCHED,
                        youtubeChecked = null,
                    )
                }
                in outcome.confirmed -> track.copy(youtubeChecked = YouTubeCheckStamp(vid, now))
                else -> track
            }
        }
        return next to cleared
    }
}
