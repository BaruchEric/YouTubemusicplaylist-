package com.cratesync

import com.cratesync.model.LocalTrack
import com.cratesync.model.MatchStatus
import com.cratesync.model.YouTubeCheckStamp
import com.cratesync.youtube.MatchConfidence
import com.cratesync.youtube.MatchRefresh
import com.cratesync.youtube.YouTubeApi
import com.cratesync.youtube.YouTubeBulkMatch
import com.cratesync.youtube.YouTubePlaylistItem
import com.cratesync.youtube.YouTubePush
import com.cratesync.youtube.YouTubeVideoSummary
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class YouTubeEnginesTest {

    private fun track(
        id: String,
        title: String,
        artist: String,
        videoId: String? = null,
        checkedAt: Long? = null,
    ) = LocalTrack(
        id = id,
        fileKey = "music/$id.mp3::1000",
        fileName = "$id.mp3",
        relativePath = "Music/$id.mp3",
        folderName = "Music",
        title = title,
        artist = artist,
        album = "Album",
        addedAt = 1000L,
        lastSeenAt = 1000L,
        youtubeVideoId = videoId,
        matchStatus = if (videoId != null) MatchStatus.MATCHED else MatchStatus.UNMATCHED,
        youtubeChecked = if (videoId != null && checkedAt != null) YouTubeCheckStamp(videoId, checkedAt) else null,
    )

    @Test
    fun bulkMatchRejectsVersionWordMismatchAndPrioritizesTopicChannel() {
        val original = track("t1", "Dreams", "Fleetwood Mac")
        val acousticCandidate = YouTubeVideoSummary("vid-ac", "Dreams (Acoustic Cover)", "Cover Channel")
        val topicCandidate = YouTubeVideoSummary("vid-top", "Dreams", "Fleetwood Mac - Topic")

        assertNull(YouTubeBulkMatch.scoreCandidate(original.title, original.artist, original.album, acousticCandidate))
        assertEquals(
            MatchConfidence.EXACT,
            YouTubeBulkMatch.scoreCandidate(original.title, original.artist, original.album, topicCandidate),
        )
        val picked = YouTubeBulkMatch.pickSearchResult(original, listOf(acousticCandidate, topicCandidate))
        assertEquals("vid-top", picked?.candidate?.videoId)
    }

    @Test
    fun likedMusicPlaylistIdTranslatesLmToLl() {
        assertEquals("LL", YouTubeBulkMatch.playlistIdForLookup("https://music.youtube.com/playlist?list=LM"))
    }

    @Test
    fun youtubePushUsesMinimalLisReorders() {
        // Remote order: [A, C, B, D] -> Wanted: [A, B, C, D]
        // LIS is [A, C, D] or [A, B, D] (length 3), so only 1 move is needed!
        val orderPlan = YouTubePush.planOrder(
            wanted = listOf("A", "B", "C", "D"),
            remote = listOf("A", "C", "B", "D"),
        )
        assertEquals(1, orderPlan.moves.size)
        assertTrue(orderPlan.moves.first() in setOf("B", "C"))
    }

    @Test
    fun matchRefreshClearsUnavailableVideosOlderThan30Days() = runTest {
        val now = 100L * 24 * 60 * 60 * 1000
        val staleAlive = track("t1", "Alive", "Artist", videoId = "vid-ok", checkedAt = now - MatchRefresh.MATCH_REFRESH_MS - 1000L)
        val staleGone = track("t2", "Gone", "Artist", videoId = "vid-gone", checkedAt = now - MatchRefresh.MATCH_REFRESH_MS - 1000L)
        val fresh = track("t3", "Fresh", "Artist", videoId = "vid-fresh", checkedAt = now - 1000L)

        val fakeApi = object : YouTubeApi {
            override suspend fun searchVideos(query: String, maxResults: Int) = emptyList<YouTubeVideoSummary>()
            override suspend fun listExistingVideoIds(videoIds: List<String>) = setOf("vid-ok")
            override suspend fun listPlaylistItems(playlistId: String) = emptyList<YouTubePlaylistItem>()
            override suspend fun createPlaylist(title: String, description: String) = "pl-1"
            override suspend fun insertPlaylistItem(playlistId: String, videoId: String, position: Int?) = Unit
            override suspend fun deletePlaylistItem(itemId: String) = Unit
            override suspend fun movePlaylistItem(playlistId: String, itemId: String, videoId: String, position: Int) = Unit
        }

        val due = MatchRefresh.matchesDueForRefresh(listOf(staleAlive, staleGone, fresh), now)
        assertEquals(setOf("t1", "t2"), due.map { it.id }.toSet())

        val outcome = MatchRefresh.refreshMatches(fakeApi, listOf(staleAlive, staleGone, fresh), now)
        val (updated, cleared) = MatchRefresh.applyRefresh(listOf(staleAlive, staleGone, fresh), outcome, now)
        assertEquals(1, cleared)
        assertEquals(MatchStatus.MATCHED, updated.first { it.id == "t1" }.matchStatus)
        assertEquals(now, updated.first { it.id == "t1" }.youtubeChecked?.at)
        assertEquals(MatchStatus.UNMATCHED, updated.first { it.id == "t2" }.matchStatus)
        assertNull(updated.first { it.id == "t2" }.youtubeVideoId)
    }
}
