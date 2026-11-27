package com.cratesync.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class MatchStatus {
    @SerialName("unmatched") UNMATCHED,
    @SerialName("matched") MATCHED,
    @SerialName("skipped") SKIPPED,
}

@Serializable
data class YouTubeCheckStamp(
    val videoId: String,
    val at: Long,
)

@Serializable
data class LocalTrack(
    val id: String,
    val fileKey: String,
    val fileName: String,
    val relativePath: String,
    val folderName: String,
    val title: String,
    val artist: String,
    val album: String,
    val genre: String? = null,
    val year: String = "",
    val trackNumber: Int? = null,
    val duration: Double = 0.0,
    val format: String = "MP3",
    val fileSize: Long = 0L,
    val contentHash: String? = null,
    val coverArtUrl: String? = null,
    val addedAt: Long,
    val lastSeenAt: Long,
    val isMissingOnDevice: Boolean = false,
    val youtubeVideoId: String? = null,
    val youtubeTitle: String? = null,
    val matchStatus: MatchStatus = MatchStatus.UNMATCHED,
    val youtubeChecked: YouTubeCheckStamp? = null,
    val playCount: Int? = null,
    val skipCount: Int? = null,
    val lastPlayedAt: Long? = null,
    val driveFileId: String? = null,
    val driveModifiedTime: String? = null,
    val drivePath: String? = null,
    val cachedOnDeviceAt: Long? = null,
    val updatedAt: Long? = null,
)

@Serializable
enum class PlayEventOutcome {
    @SerialName("completed") COMPLETED,
    @SerialName("skipped") SKIPPED,
}

@Serializable
data class TrackPlayStats(
    val playCount: Int = 0,
    val completedCount: Int = 0,
    val skipCount: Int = 0,
    val lastPlayedAt: Long? = null,
)

@Serializable
data class PlayHistoryEntry(
    val id: String,
    val trackId: String,
    val title: String,
    val artist: String,
    val album: String,
    val coverArtUrl: String? = null,
    val playedAt: Long,
    val outcome: PlayEventOutcome,
    val listenedSeconds: Double,
    val duration: Double,
)

@Serializable
data class SyncRule(
    val autoAddNewFiles: Boolean = false,
    val removeMissingFiles: Boolean = false,
    val folderFilter: String = "",
)

@Serializable
data class YouTubePushRecord(
    val playlistId: String,
    val videoIds: List<String>,
    val pushedAt: Long,
)

@Serializable
data class Playlist(
    val id: String,
    val name: String,
    val description: String = "",
    val createdAt: Long,
    val updatedAt: Long,
    val lastSyncedAt: Long? = null,
    val trackIds: List<String> = emptyList(),
    val syncedTrackIds: List<String> = emptyList(),
    val youtubePlaylistUrl: String = "",
    val youtubePush: YouTubePushRecord? = null,
    val watchedFolderName: String? = null,
    val syncRule: SyncRule = SyncRule(),
)

data class PlaylistDiff(
    val playlistId: String,
    val toAdd: List<LocalTrack>,
    val toRemove: List<LocalTrack>,
    val missingOnDevice: List<LocalTrack>,
    val unmatchedCount: Int,
    val matchedCount: Int,
    val hasChanges: Boolean,
)

@Serializable
data class SyncEvent(
    val id: String,
    val playlistId: String,
    val playlistName: String,
    val timestamp: Long,
    val addedCount: Int,
    val removedCount: Int,
    val matchedCount: Int,
    val totalTracks: Int,
    val summary: String,
)

@Serializable
enum class SmartRuleField {
    @SerialName("genre") GENRE,
    @SerialName("artist") ARTIST,
    @SerialName("album") ALBUM,
    @SerialName("title") TITLE,
    @SerialName("format") FORMAT,
    @SerialName("year") YEAR,
    @SerialName("playCount") PLAY_COUNT,
    @SerialName("duration") DURATION,
    @SerialName("matchStatus") MATCH_STATUS,
    @SerialName("folderName") FOLDER_NAME,
    @SerialName("addedDaysAgo") ADDED_DAYS_AGO,
}

@Serializable
enum class SmartRuleOperator {
    @SerialName("contains") CONTAINS,
    @SerialName("not_contains") NOT_CONTAINS,
    @SerialName("equals") EQUALS,
    @SerialName("not_equals") NOT_EQUALS,
    @SerialName("gt") GT,
    @SerialName("gte") GTE,
    @SerialName("lt") LT,
    @SerialName("lte") LTE,
}

@Serializable
data class SmartPlaylistRule(
    val id: String,
    val field: SmartRuleField,
    val operator: SmartRuleOperator,
    val value: String,
)

@Serializable
enum class SmartPlaylistMatchMode {
    @SerialName("all") ALL,
    @SerialName("any") ANY,
}

@Serializable
enum class SmartPlaylistSortBy {
    @SerialName("addedAt") ADDED_AT,
    @SerialName("playCount") PLAY_COUNT,
    @SerialName("lastPlayedAt") LAST_PLAYED_AT,
    @SerialName("title") TITLE,
    @SerialName("artist") ARTIST,
    @SerialName("duration") DURATION,
    @SerialName("year") YEAR,
}

@Serializable
enum class SmartPlaylistSortDir {
    @SerialName("asc") ASC,
    @SerialName("desc") DESC,
}

@Serializable
data class SmartPlaylist(
    val id: String,
    val name: String,
    val description: String = "",
    val matchMode: SmartPlaylistMatchMode = SmartPlaylistMatchMode.ALL,
    val rules: List<SmartPlaylistRule> = emptyList(),
    val sortBy: SmartPlaylistSortBy = SmartPlaylistSortBy.ADDED_AT,
    val sortDir: SmartPlaylistSortDir = SmartPlaylistSortDir.DESC,
    val excludeMissing: Boolean = true,
    val createdAt: Long,
    val updatedAt: Long,
)

enum class WorkspaceView {
    DASHBOARD,
    SCANNER,
    PLAYLIST,
    SMART_PLAYLIST,
    SYNC,
    SCAN_LOGS,
    TRANSFER,
}

@Serializable
enum class DirectoryWatcherStatus {
    @SerialName("watching") WATCHING,
    @SerialName("syncing") SYNCING,
    @SerialName("idle") IDLE,
    @SerialName("paused") PAUSED,
}

@Serializable
enum class ScanTriggerSource {
    @SerialName("manual-folder") MANUAL_FOLDER,
    @SerialName("background-watch") BACKGROUND_WATCH,
    @SerialName("file-picker") FILE_PICKER,
    @SerialName("drag-drop") DRAG_DROP,
    @SerialName("drive-mapping") DRIVE_MAPPING,
}

@Serializable
enum class ScanErrorCode {
    @SerialName("permission") PERMISSION,
    @SerialName("unreadable-file") UNREADABLE_FILE,
    @SerialName("inaccessible-folder") INACCESSIBLE_FOLDER,
    @SerialName("metadata-parse") METADATA_PARSE,
    @SerialName("unknown") UNKNOWN,
}

@Serializable
data class ScanErrorEntry(
    val path: String,
    val message: String,
    val code: ScanErrorCode,
)

@Serializable
enum class ScanLogStatus {
    @SerialName("completed") COMPLETED,
    @SerialName("completed-with-errors") COMPLETED_WITH_ERRORS,
    @SerialName("failed") FAILED,
}

@Serializable
data class ScanLogEntry(
    val id: String,
    val startedAt: Long,
    val completedAt: Long,
    val durationMs: Long,
    val source: ScanTriggerSource,
    val folderName: String,
    val totalFilesEncountered: Int,
    val audioFilesProcessed: Int,
    val addedCount: Int,
    val updatedCount: Int,
    val restoredCount: Int,
    val missingCount: Int,
    val skippedNonAudioCount: Int,
    val status: ScanLogStatus,
    val errors: List<ScanErrorEntry> = emptyList(),
)

@Serializable
data class WatchedFolderRecord(
    val name: String,
    val nativePathOrUri: String = "",
    val lastScannedAt: Long? = null,
    val fileKeys: Set<String> = emptySet(),
    val hasLiveAccess: Boolean = false,
)

@Serializable
enum class FolderSyncDirection {
    @SerialName("pull") PULL,
    @SerialName("push") PUSH,
    @SerialName("bidirectional") BIDIRECTIONAL,
}

@Serializable
data class SyncDeviceProfile(
    val id: String,
    val name: String,
    val platform: String,
    val lastSeenAt: Long,
)

@Serializable
data class DeviceFolderBinding(
    val deviceId: String,
    val localFolderPath: String = "",
    val syncDirection: FolderSyncDirection = FolderSyncDirection.BIDIRECTIONAL,
    val autoCacheOffline: Boolean = false,
    val lastSyncedAt: Long? = null,
    val updatedAt: Long? = null,
)

@Serializable
data class FolderMappingTombstone(
    val driveFolderId: String,
    val deviceId: String? = null,
    val deletedAt: Long,
)

@Serializable
data class DriveFolderMapping(
    val id: String,
    val driveFolderId: String,
    val driveFolderName: String,
    val createdAt: Long,
    val updatedAt: Long,
    val deviceBindings: Map<String, DeviceFolderBinding> = emptyMap(),
)

@Serializable
sealed class LibraryTombstone {
    abstract val id: String
    abstract val deletedAt: Long

    @Serializable
    @SerialName("track")
    data class Track(
        override val id: String,
        val fileKey: String,
        val driveFileId: String? = null,
        override val deletedAt: Long,
    ) : LibraryTombstone()

    @Serializable
    @SerialName("playlist")
    data class PlaylistTombstone(
        override val id: String,
        override val deletedAt: Long,
    ) : LibraryTombstone()

    @Serializable
    @SerialName("smart-playlist")
    data class SmartPlaylistTombstone(
        override val id: String,
        override val deletedAt: Long,
    ) : LibraryTombstone()
}

@Serializable
enum class CrossfadeCurve {
    @SerialName("equal-power") EQUAL_POWER,
    @SerialName("smooth-s") SMOOTH_S,
    @SerialName("linear") LINEAR,
}

@Serializable
data class PlaybackTransitionSettings(
    val crossfadeSeconds: Double = 4.0,
    val crossfadeCurve: CrossfadeCurve = CrossfadeCurve.EQUAL_POWER,
    val manualSkipCrossfade: Boolean = true,
    val gaplessPlayback: Boolean = true,
    val gaplessAlbumContinuity: Boolean = true,
)

@Serializable
enum class ReplayGainMode {
    @SerialName("off") OFF,
    @SerialName("track") TRACK,
    @SerialName("album") ALBUM,
}

@Serializable
data class ReplayGainSettings(
    val mode: ReplayGainMode = ReplayGainMode.TRACK,
    val targetLufs: Int = -14,
    val preampDb: Double = 0.0,
    val preventClipping: Boolean = true,
)

@Serializable
data class TrackLoudnessData(
    val integratedLufs: Double,
    val peak: Double,
    val analyzedAt: Long,
    val album: String? = null,
)

@Serializable
data class SavedDashboardFilter(
    val id: String,
    val name: String,
    val query: String,
    val createdAt: Long,
)

enum class ToastLevel { INFO, SUCCESS, WARNING, ERROR }

data class AppToast(
    val id: String,
    val message: String,
    val level: ToastLevel = ToastLevel.INFO,
)

data class ConfirmationRequest(
    val id: String,
    val title: String,
    val message: String,
    val confirmLabel: String,
    val isDestructive: Boolean = false,
    val showYouTubeLegalNotice: Boolean = false,
    val onConfirm: () -> Unit,
)
