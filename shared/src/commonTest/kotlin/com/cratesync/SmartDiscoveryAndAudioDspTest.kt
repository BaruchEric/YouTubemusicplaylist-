package com.cratesync

import com.cratesync.core.AudioTransitions
import com.cratesync.core.ReplayGainEngine
import com.cratesync.core.SmartPlaylists
import com.cratesync.core.SmartSearch
import com.cratesync.core.UpcomingTransitionMode
import com.cratesync.drive.DriveChildrenGateway
import com.cratesync.drive.DriveFairDfsFolderCounter
import com.cratesync.drive.DriveFolderItem
import com.cratesync.model.CrossfadeCurve
import com.cratesync.model.LocalTrack
import com.cratesync.model.MatchStatus
import com.cratesync.model.PlaybackTransitionSettings
import com.cratesync.model.ReplayGainMode
import com.cratesync.model.ReplayGainSettings
import com.cratesync.model.TrackLoudnessData
import com.cratesync.model.TrackPlayStats
import kotlinx.coroutines.test.runTest
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class SmartDiscoveryAndAudioDspTest {

    private fun track(
        id: String,
        title: String,
        artist: String,
        album: String,
        format: String = "FLAC",
        genre: String = "Electronic",
        year: String = "2023",
        trackNumber: Int? = 1,
        duration: Double = 320.0,
    ) = LocalTrack(
        id = id,
        fileKey = "music/$id.$format::10000",
        fileName = "$id.$format",
        relativePath = "Music/$id.$format",
        folderName = "Music",
        title = title,
        artist = artist,
        album = album,
        genre = genre,
        year = year,
        trackNumber = trackNumber,
        duration = duration,
        format = format,
        fileSize = 10_000L,
        addedAt = 5000L,
        lastSeenAt = 5000L,
        matchStatus = MatchStatus.MATCHED,
        youtubeVideoId = "vid-$id",
    )

    @Test
    fun smartPlaylistsAndSmartSearchOperatorsEvaluateAccurately() {
        val t1 = track("1", "Strobe", "Deadmau5", "For Lack of a Better Name", format = "FLAC", year = "2009", duration = 637.0)
        val t2 = track("2", "Windowlicker", "Aphex Twin", "Windowlicker", format = "MP3", year = "1999", duration = 367.0)
        val stats = mapOf("1" to TrackPlayStats(playCount = 12, completedCount = 12))

        val losslessPreset = SmartPlaylists.fromPreset(SmartPlaylists.PRESETS.first { it.id == "lossless-vault" }, now = 10_000L)
        val matched = SmartPlaylists.evaluate(losslessPreset, listOf(t1, t2), stats, nowMs = 10_000L)
        assertEquals(listOf("1"), matched.map { it.id })

        val (_, searchResults) = SmartSearch.evaluateTracks(
            rawQuery = "format:flac year:2005-2012 duration:>5m strobe",
            tracks = listOf(t1, t2),
            playStats = stats,
        )
        assertEquals(1, searchResults.size)
        assertEquals("1", searchResults.first().track.id)
    }

    @Test
    fun audioTransitionsPreserveGaplessAlbumContinuityAndEqualPowerCurve() {
        val mid = AudioTransitions.evaluateCurve(0.5, CrossfadeCurve.EQUAL_POWER)
        val energy = mid.outgoing * mid.outgoing + mid.incoming * mid.incoming
        assertTrue(abs(energy - 1.0) < 1e-6)

        val a1 = track("a1", "Track 1", "Daft Punk", "Discovery", trackNumber = 1)
        val a2 = track("a2", "Track 2", "Daft Punk", "Discovery", trackNumber = 2)
        val desc = AudioTransitions.describeUpcoming(
            currentTrack = a1,
            nextTrack = a2,
            isShuffled = false,
            settings = PlaybackTransitionSettings(crossfadeSeconds = 5.0, gaplessAlbumContinuity = true),
        )
        assertEquals(UpcomingTransitionMode.GAPLESS_ALBUM, desc.mode)
    }

    @Test
    fun replayGainComputesLufsAndAppliesClippingGuard() {
        val sampleRate = 48_000
        val frames = sampleRate // 1 second 1kHz sine at 0.25 amplitude
        val sine = FloatArray(frames) { i -> (0.25 * sin(2.0 * PI * 1000.0 * i / sampleRate)).toFloat() }
        val measured = ReplayGainEngine.analyzePcmLoudness(listOf(sine, sine), sampleRate, analyzedAt = 1000L, album = "Test Album")
        assertTrue(measured.integratedLufs < -10.0 && measured.integratedLufs > -25.0)
        assertTrue(measured.peak in 0.24..0.26)

        val hotTrack = TrackLoudnessData(integratedLufs = -24.0, peak = 0.95, analyzedAt = 1000L, album = "Test Album")
        val adj = ReplayGainEngine.computeAdjustment(
            trackKey = "k1",
            trackAlbum = "Test Album",
            cache = mapOf("k1" to hotTrack),
            settings = ReplayGainSettings(mode = ReplayGainMode.TRACK, targetLufs = -14, preampDb = 0.0, preventClipping = true),
            libraryAlbumLookup = mapOf("k1" to "Test Album"),
        )
        assertNotNull(adj)
        assertTrue(adj.clippingPrevented)
        assertTrue(adj.linearGain * hotTrack.peak <= 1.0)
    }

    @Test
    fun driveFairDfsFindsAudioInsideDeepMusicFolderWithoutStarvation() = runTest {
        val tree = mapOf(
            "config" to (listOf(DriveFolderItem("c1", "sub1"), DriveFolderItem("c2", "sub2")) to 0),
            "c1" to (emptyList<DriveFolderItem>() to 0),
            "c2" to (emptyList<DriveFolderItem>() to 0),
            "music" to (listOf(DriveFolderItem("m-rock", "Rock")) to 2),
            "m-rock" to (emptyList<DriveFolderItem>() to 15),
        )
        val gateway = object : DriveChildrenGateway {
            override suspend fun listDirectChildren(parentId: String): Pair<List<DriveFolderItem>, Int> =
                tree[parentId] ?: (emptyList<DriveFolderItem>() to 0)
        }
        val counter = DriveFairDfsFolderCounter(gateway)
        val stats = counter.countFolderStats(
            roots = listOf(DriveFolderItem("config", ".config"), DriveFolderItem("music", "Music")),
            deadlineMs = 10_000L,
        )
        assertEquals(0, stats["config"]?.audioCount)
        assertEquals(17, stats["music"]?.audioCount)
        assertEquals(false, stats["music"]?.isPartial)
    }
}
