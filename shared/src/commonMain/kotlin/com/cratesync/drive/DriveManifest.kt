package com.cratesync.drive

import com.cratesync.model.DriveFolderMapping
import com.cratesync.model.FolderMappingTombstone
import com.cratesync.model.LibraryTombstone
import com.cratesync.model.LocalTrack
import com.cratesync.model.Playlist
import com.cratesync.model.SmartPlaylist
import com.cratesync.model.SyncDeviceProfile
import com.cratesync.model.SyncEvent
import kotlinx.serialization.Serializable

/**
 * Canonical cratesync-source-of-truth.json manifest wire format shared across Android, iOS, Desktop, and Web.
 */
@Serializable
data class DriveManifest(
    val version: Int = 2,
    val exportedAt: Long,
    val sourceDeviceId: String = "",
    val tracks: List<LocalTrack> = emptyList(),
    val playlists: List<Playlist> = emptyList(),
    val smartPlaylists: List<SmartPlaylist> = emptyList(),
    val syncHistory: List<SyncEvent> = emptyList(),
    val tombstones: List<LibraryTombstone> = emptyList(),
    val devices: List<SyncDeviceProfile> = emptyList(),
    val folderMappings: List<DriveFolderMapping> = emptyList(),
    val folderMappingTombstones: List<FolderMappingTombstone> = emptyList(),
)

data class DriveFolderItem(
    val id: String,
    val name: String,
    val modifiedTime: String = "",
    val parents: List<String> = emptyList(),
)

data class DriveAudioFile(
    val id: String,
    val name: String,
    val mimeType: String,
    val size: Long,
    val modifiedTime: String = "",
    val folderPath: String = "Google Drive",
)

data class DriveFolderCountStats(
    val audioCount: Int,
    val subfolderCount: Int,
    val isPartial: Boolean = false,
)

enum class DriveFolderScope { MY_DRIVE, SHARED_WITH_ME }
