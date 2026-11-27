package com.cratesync

import com.cratesync.core.AudioIntegrityScanner
import com.cratesync.core.BinaryAudioParser
import com.cratesync.core.DuplicateDetector
import com.cratesync.core.IntegritySeverity
import com.cratesync.core.ScanMatchResult
import com.cratesync.core.ScanMatcher
import com.cratesync.core.ScannedFile
import com.cratesync.core.Sha256
import com.cratesync.core.foldFileName
import com.cratesync.core.linkDriveSongToLocalFile
import com.cratesync.model.LocalTrack
import com.cratesync.model.Playlist
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ScanAndBinaryAudioTest {

    @Test
    fun unicodeNfcFoldingMatchesMacOsDecomposedToComposed() {
        val decomposed = "Cafe\u0301.mp3" // NFD
        val composed = "Caf\u00E9.mp3"    // NFC
        assertEquals(foldFileName(composed), foldFileName(decomposed))
    }

    @Test
    fun sha256MatchesStandardTestVector() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            Sha256.digestHex("abc".encodeToByteArray()),
        )
    }

    @Test
    fun scanMatcherLinksDriveStubToLocalFile() {
        val driveStub = LocalTrack(
            id = "stub-1",
            fileKey = "drive::gfile123",
            fileName = "Midnight Groove.flac",
            relativePath = "Google Drive/Midnight Groove.flac",
            folderName = "Google Drive",
            title = "Midnight Groove",
            artist = "Crate DJ",
            album = "Vault",
            fileSize = 42_000_000L,
            addedAt = 1000L,
            lastSeenAt = 1000L,
            driveFileId = "gfile123",
            isMissingOnDevice = true,
        )
        val matcher = ScanMatcher(listOf(driveStub)) { false }
        val scanned = ScannedFile("Midnight Groove.flac", 42_000_000L, "Music/Midnight Groove.flac")
        val match = matcher.match(scanned)
        assertIs<ScanMatchResult.DriveCopy>(match)

        val linked = linkDriveSongToLocalFile(match.track, scanned)
        assertEquals("Music", linked.folderName)
        assertEquals("Music/Midnight Groove.flac", linked.relativePath)
        assertEquals(false, linked.isMissingOnDevice)
    }

    @Test
    fun binaryAudioParserReadsWavHeaderAndIntegrityScannerValidates() {
        // Minimal valid 44-byte RIFF WAVE PCM header (44100 Hz, stereo, 16-bit, 1 second = 176400 bytes)
        val wav = ByteArray(44)
        "RIFF".encodeToByteArray().copyInto(wav, 0)
        "WAVE".encodeToByteArray().copyInto(wav, 8)
        "fmt ".encodeToByteArray().copyInto(wav, 12)
        wav[16] = 16 // PCM chunk size
        wav[20] = 1  // PCM format
        wav[22] = 2  // 2 channels
        // Sample rate 44100 = 0x0000AC44 little-endian
        wav[24] = 0x44; wav[25] = 0xAC.toByte()
        // Byte rate 176400 = 0x0002B110 little-endian
        wav[28] = 0x10; wav[29] = 0xB1.toByte(); wav[30] = 0x02
        wav[32] = 4; wav[34] = 16
        "data".encodeToByteArray().copyInto(wav, 36)
        wav[40] = 0x10; wav[41] = 0xB1.toByte(); wav[42] = 0x02

        val parsed = BinaryAudioParser.parseHeaderAndTail(wav, null, 176_444L, "Artist Name - Sample Track.wav")
        assertEquals("Artist Name", parsed.artist)
        assertEquals("Sample Track", parsed.title)
        assertTrue(parsed.durationSeconds in 0.9..1.1)

        val track = LocalTrack(
            id = "w1",
            fileKey = "music/sample.wav::176444",
            fileName = "Artist Name - Sample Track.wav",
            relativePath = "Music/Artist Name - Sample Track.wav",
            folderName = "Music",
            title = "Sample Track",
            artist = "Artist Name",
            album = "Singles",
            duration = 1.0,
            format = "WAV",
            fileSize = 176_444L,
            addedAt = 1000L,
            lastSeenAt = 1000L,
        )
        val report = AudioIntegrityScanner.inspectTrackBytes(track, wav)
        assertEquals(IntegritySeverity.HEALTHY, report.severity)
    }

    @Test
    fun duplicateDetectorPrefersLosslessAndRemapsPlaylists() {
        val flac = LocalTrack(
            id = "t-flac",
            fileKey = "music/song.flac::30000000",
            fileName = "song.flac",
            relativePath = "Music/song.flac",
            folderName = "Music",
            title = "Sunset",
            artist = "Nujabes",
            album = "Modal Soul",
            duration = 210.0,
            format = "FLAC",
            fileSize = 30_000_000L,
            addedAt = 1000L,
            lastSeenAt = 1000L,
        )
        val mp3 = flac.copy(
            id = "t-mp3",
            fileKey = "music/song.mp3::5000000",
            fileName = "song.mp3",
            relativePath = "Music/song.mp3",
            format = "MP3",
            fileSize = 5_000_000L,
        )
        val groups = DuplicateDetector.findDuplicateGroups(listOf(mp3, flac))
        assertEquals(1, groups.size)
        assertEquals("t-flac", groups.first().recommendedKeeperId)

        val pl = Playlist("p1", "Chill", createdAt = 1000L, updatedAt = 1000L, trackIds = listOf("t-mp3"))
        val res = DuplicateDetector.removeDuplicatesWithRemap(
            tracks = listOf(mp3, flac),
            playlists = listOf(pl),
            duplicateToKeeper = mapOf("t-mp3" to "t-flac"),
            now = 2000L,
        )
        assertEquals(listOf("t-flac"), res.remainingTracks.map { it.id })
        assertEquals(listOf("t-flac"), res.updatedPlaylists.first().trackIds)
        assertEquals(1, res.remappedReferences)
    }
}
