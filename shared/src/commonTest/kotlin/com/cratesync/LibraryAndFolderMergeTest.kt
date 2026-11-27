package com.cratesync

import com.cratesync.core.FolderMappingMerge
import com.cratesync.core.FolderMappingState
import com.cratesync.core.LibraryMerge
import com.cratesync.core.LibrarySnapshot
import com.cratesync.model.DeviceFolderBinding
import com.cratesync.model.DriveFolderMapping
import com.cratesync.model.FolderMappingTombstone
import com.cratesync.model.FolderSyncDirection
import com.cratesync.model.LibraryTombstone
import com.cratesync.model.LocalTrack
import com.cratesync.model.Playlist
import com.cratesync.model.SyncDeviceProfile
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LibraryAndFolderMergeTest {

    private fun track(
        id: String,
        title: String = "Track $id",
        updatedAt: Long? = 1000L,
        addedAt: Long = 1000L,
        driveFileId: String? = null,
    ) = LocalTrack(
        id = id,
        fileKey = "music/$id.mp3::1024",
        fileName = "$id.mp3",
        relativePath = "Music/$id.mp3",
        folderName = "Music",
        title = title,
        artist = "Artist",
        album = "Album",
        fileSize = 1024L,
        addedAt = addedAt,
        lastSeenAt = addedAt,
        driveFileId = driveFileId,
        updatedAt = updatedAt,
    )

    @Test
    fun newestEditWinsAndTombstoneSuppressesDeletedTrack() {
        val now = 10_000L
        val localTrack = track("t1", title = "Local Older", updatedAt = 2000L)
        val remoteTrack = track("t1", title = "Remote Newer", updatedAt = 5000L)
        val deletedRemote = track("t2", title = "Should Stay Deleted", updatedAt = 2000L)
        val tomb = LibraryMerge.trackTombstone(deletedRemote, deletedAt = 6000L)

        val local = LibrarySnapshot(
            tracks = listOf(localTrack),
            playlists = listOf(Playlist("p1", "Crate", createdAt = 1000L, updatedAt = 2000L, trackIds = listOf("t1"))),
            smartPlaylists = emptyList(),
            syncHistory = emptyList(),
            tombstones = listOf(tomb),
        )
        val remote = LibrarySnapshot(
            tracks = listOf(remoteTrack, deletedRemote),
            playlists = emptyList(),
            smartPlaylists = emptyList(),
            syncHistory = emptyList(),
            tombstones = emptyList(),
        )

        val merged = LibraryMerge.mergeLibraryForPush(local, remote, holdsAudio = { false }, now = now)
        assertEquals(1, merged.library.tracks.size)
        assertEquals("Remote Newer", merged.library.tracks.first().title)
        assertTrue(merged.revivedTrackIds.isEmpty())
    }

    @Test
    fun deviceHoldingOfflineAudioRevivesTombstonedTrack() {
        val now = 20_000L
        val localTrack = track("t1", title = "Offline Keeper", updatedAt = 1000L)
        val remoteTomb = LibraryMerge.trackTombstone(localTrack, deletedAt = 5000L)

        val local = LibrarySnapshot(listOf(localTrack), emptyList(), emptyList(), emptyList(), emptyList())
        val remote = LibrarySnapshot(emptyList(), emptyList(), emptyList(), emptyList(), listOf(remoteTomb))

        val merged = LibraryMerge.mergeLibraryForPush(local, remote, holdsAudio = { it.id == "t1" }, now = now)
        assertEquals(1, merged.library.tracks.size)
        assertEquals(listOf("t1"), merged.revivedTrackIds)
        assertEquals(now, merged.library.tracks.first().updatedAt)
    }

    @Test
    fun tombstonesOlderThan365DaysArePruned() {
        val now = 2_000_000_000_000L
        val expired = LibraryTombstone.PlaylistTombstone("old", deletedAt = now - LibraryMerge.TOMBSTONE_MAX_AGE_MS - 1L)
        val fresh = LibraryTombstone.PlaylistTombstone("new", deletedAt = now - 10_000L)
        val kept = LibraryMerge.mergeLibraryTombstones(listOf(listOf(expired, fresh)), now)
        assertEquals(1, kept.size)
        assertEquals("new", kept.first().id)
    }

    @Test
    fun folderMappingMergePreservesOwnDeviceBindingAndRespectsTombstones() {
        val now = 50_000L
        val devA = "dev-mac"
        val devB = "dev-android"

        val localMapping = DriveFolderMapping(
            id = "m1",
            driveFolderId = "drive-music",
            driveFolderName = "Music",
            createdAt = 1000L,
            updatedAt = 2000L,
            deviceBindings = mapOf(
                devA to DeviceFolderBinding(devA, "Users/dj/Music", FolderSyncDirection.BIDIRECTIONAL, true, null, 2000L)
            ),
        )
        val remoteMapping = DriveFolderMapping(
            id = "m1",
            driveFolderId = "drive-music",
            driveFolderName = "Music",
            createdAt = 1000L,
            updatedAt = 3000L,
            deviceBindings = mapOf(
                devB to DeviceFolderBinding(devB, "storage/Music", FolderSyncDirection.PULL, false, null, 3000L)
            ),
        )
        val deletedRemoteMapping = DriveFolderMapping(
            id = "m2",
            driveFolderId = "drive-old",
            driveFolderName = "Old",
            createdAt = 1000L,
            updatedAt = 2000L,
        )
        val tomb = FolderMappingTombstone("drive-old", null, deletedAt = 4000L)

        val merged = FolderMappingMerge.mergeFolderMappingState(
            local = FolderMappingState(listOf(localMapping), listOf(tomb)),
            remote = FolderMappingState(listOf(remoteMapping, deletedRemoteMapping), emptyList()),
            localDeviceId = devA,
            now = now,
        )

        assertEquals(1, merged.folderMappings.size)
        val combined = merged.folderMappings.first()
        assertTrue(devA in combined.deviceBindings)
        assertTrue(devB in combined.deviceBindings)
        assertEquals("Users/dj/Music", combined.deviceBindings[devA]?.localFolderPath)

        val translated = FolderMappingMerge.translateRelativePathForDevice("track.flac", "/Users/dj/Music/", "Music")
        assertEquals("Music", translated.first)
        assertEquals("Users/dj/Music/track.flac", translated.second)

        val mergedDevices = FolderMappingMerge.mergeDeviceProfiles(
            localDevices = listOf(SyncDeviceProfile(devA, "MacBook", "macOS", now)),
            remoteDevices = listOf(SyncDeviceProfile(devB, "Pixel", "Android", now - 1000L)),
            currentDevice = SyncDeviceProfile(devA, "MacBook", "macOS", now),
        )
        assertEquals(2, mergedDevices.size)
        assertEquals(devA, mergedDevices.first().id)
        assertFalse(merged.folderMappingTombstones.isEmpty())
    }
}
