package com.cratesync.state

import com.cratesync.core.LibraryMerge
import com.cratesync.db.CrateSyncDatabase
import com.cratesync.model.DriveFolderMapping
import com.cratesync.model.FolderMappingTombstone
import com.cratesync.model.LibraryTombstone
import com.cratesync.model.LocalTrack
import com.cratesync.model.PlayHistoryEntry
import com.cratesync.model.PlaybackTransitionSettings
import com.cratesync.model.Playlist
import com.cratesync.model.ReplayGainSettings
import com.cratesync.model.SavedDashboardFilter
import com.cratesync.model.ScanLogEntry
import com.cratesync.model.SmartPlaylist
import com.cratesync.model.SyncDeviceProfile
import com.cratesync.model.SyncEvent
import com.cratesync.model.TrackLoudnessData
import com.cratesync.model.TrackPlayStats
import com.cratesync.model.WatchedFolderRecord
import com.cratesync.platform.PlatformDatabaseDriverFactory
import com.cratesync.platform.currentTimeMillis
import com.cratesync.platform.detectPlatformName
import com.cratesync.platform.randomUuid
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Local-first SQLDelight repository exposing unidirectional StateFlows and automatically
 * stamping `updatedAt` on every track or playlist edit for conflict-free Drive sync.
 */
class LibraryRepository(
    driverFactory: PlatformDatabaseDriverFactory,
) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val database: CrateSyncDatabase? = driverFactory.createDriver()?.let { CrateSyncDatabase(it) }
    private val queries get() = database?.crateSyncDatabaseQueries

    private val _tracks = MutableStateFlow<List<LocalTrack>>(emptyList())
    val tracks: StateFlow<List<LocalTrack>> = _tracks.asStateFlow()

    private val _playlists = MutableStateFlow<List<Playlist>>(emptyList())
    val playlists: StateFlow<List<Playlist>> = _playlists.asStateFlow()

    private val _smartPlaylists = MutableStateFlow<List<SmartPlaylist>>(emptyList())
    val smartPlaylists: StateFlow<List<SmartPlaylist>> = _smartPlaylists.asStateFlow()

    private val _syncHistory = MutableStateFlow<List<SyncEvent>>(emptyList())
    val syncHistory: StateFlow<List<SyncEvent>> = _syncHistory.asStateFlow()

    private val _scanLogs = MutableStateFlow<List<ScanLogEntry>>(emptyList())
    val scanLogs: StateFlow<List<ScanLogEntry>> = _scanLogs.asStateFlow()

    private val _watchedFolders = MutableStateFlow<List<WatchedFolderRecord>>(emptyList())
    val watchedFolders: StateFlow<List<WatchedFolderRecord>> = _watchedFolders.asStateFlow()

    private val _folderMappings = MutableStateFlow<List<DriveFolderMapping>>(emptyList())
    val folderMappings: StateFlow<List<DriveFolderMapping>> = _folderMappings.asStateFlow()

    private val _libraryTombstones = MutableStateFlow<List<LibraryTombstone>>(emptyList())
    val libraryTombstones: StateFlow<List<LibraryTombstone>> = _libraryTombstones.asStateFlow()

    private val _folderMappingTombstones = MutableStateFlow<List<FolderMappingTombstone>>(emptyList())
    val folderMappingTombstones: StateFlow<List<FolderMappingTombstone>> = _folderMappingTombstones.asStateFlow()

    private val _playStats = MutableStateFlow<Map<String, TrackPlayStats>>(emptyMap())
    val playStats: StateFlow<Map<String, TrackPlayStats>> = _playStats.asStateFlow()

    private val _playHistory = MutableStateFlow<List<PlayHistoryEntry>>(emptyList())
    val playHistory: StateFlow<List<PlayHistoryEntry>> = _playHistory.asStateFlow()

    private val _loudnessCache = MutableStateFlow<Map<String, TrackLoudnessData>>(emptyMap())
    val loudnessCache: StateFlow<Map<String, TrackLoudnessData>> = _loudnessCache.asStateFlow()

    private val _transitionSettings = MutableStateFlow(PlaybackTransitionSettings())
    val transitionSettings: StateFlow<PlaybackTransitionSettings> = _transitionSettings.asStateFlow()

    private val _replayGainSettings = MutableStateFlow(ReplayGainSettings())
    val replayGainSettings: StateFlow<ReplayGainSettings> = _replayGainSettings.asStateFlow()

    private val _savedDashboardFilters = MutableStateFlow<List<SavedDashboardFilter>>(emptyList())
    val savedDashboardFilters: StateFlow<List<SavedDashboardFilter>> = _savedDashboardFilters.asStateFlow()

    private val _bulkSearchMemory = MutableStateFlow<Map<String, Long>>(emptyMap())
    val bulkSearchMemory: StateFlow<Map<String, Long>> = _bulkSearchMemory.asStateFlow()

    private val _currentDevice = MutableStateFlow(
        SyncDeviceProfile(
            id = randomUuid(),
            name = "${detectPlatformName()} Player",
            platform = detectPlatformName(),
            lastSeenAt = currentTimeMillis(),
        )
    )
    val currentDevice: StateFlow<SyncDeviceProfile> = _currentDevice.asStateFlow()

    private val _knownDevices = MutableStateFlow<List<SyncDeviceProfile>>(listOf(_currentDevice.value))
    val knownDevices: StateFlow<List<SyncDeviceProfile>> = _knownDevices.asStateFlow()

    init {
        hydrateFromDatabase()
    }

    private fun hydrateFromDatabase() {
        val q = queries ?: return
        runCatching {
            _tracks.value = q.selectAllTracks().executeAsList().map { json.decodeFromString<LocalTrack>(it) }
            _playlists.value = q.selectAllPlaylists().executeAsList().map { json.decodeFromString<Playlist>(it) }
            _smartPlaylists.value = q.selectAllSmartPlaylists().executeAsList().map { json.decodeFromString<SmartPlaylist>(it) }
            _syncHistory.value = q.selectSyncEvents().executeAsList().map { json.decodeFromString<SyncEvent>(it) }
            _scanLogs.value = q.selectScanLogs().executeAsList().map { json.decodeFromString<ScanLogEntry>(it) }
            _watchedFolders.value = q.selectWatchedFolders().executeAsList().map { json.decodeFromString<WatchedFolderRecord>(it) }
            _folderMappings.value = q.selectFolderMappings().executeAsList().map { json.decodeFromString<DriveFolderMapping>(it) }
            _libraryTombstones.value = q.selectTombstonesByCategory("library").executeAsList().map { json.decodeFromString<LibraryTombstone>(it) }
            _folderMappingTombstones.value = q.selectTombstonesByCategory("folder-mapping").executeAsList().map { json.decodeFromString<FolderMappingTombstone>(it) }
            _playStats.value = q.selectAllPlayStats().executeAsList().associate { row ->
                row.track_id to TrackPlayStats(
                    playCount = row.play_count.toInt(),
                    completedCount = row.completed_count.toInt(),
                    skipCount = row.skip_count.toInt(),
                    lastPlayedAt = row.last_played_at,
                )
            }
            _playHistory.value = q.selectPlayHistory().executeAsList().map { json.decodeFromString<PlayHistoryEntry>(it) }
            _loudnessCache.value = q.selectAllLoudness().executeAsList().associate { row ->
                row.track_key to TrackLoudnessData(row.integrated_lufs, row.peak, row.analyzed_at, row.album)
            }
            q.selectKv("transition_settings").executeAsOneOrNull()?.let { _transitionSettings.value = json.decodeFromString(it) }
            q.selectKv("replaygain_settings").executeAsOneOrNull()?.let { _replayGainSettings.value = json.decodeFromString(it) }
            q.selectKv("dashboard_filters").executeAsOneOrNull()?.let { _savedDashboardFilters.value = json.decodeFromString(it) }
            q.selectKv("bulk_search_memory").executeAsOneOrNull()?.let { _bulkSearchMemory.value = json.decodeFromString(it) }
            q.selectKv("device_profile").executeAsOneOrNull()?.let {
                val restored = json.decodeFromString<SyncDeviceProfile>(it).copy(lastSeenAt = currentTimeMillis())
                _currentDevice.value = restored
                _knownDevices.value = listOf(restored)
            }
        }
    }

    fun setTracks(next: List<LocalTrack>, now: Long = currentTimeMillis()) {
        val stamped = LibraryMerge.stampEditedTracks(_tracks.value, next, now)
        _tracks.value = stamped
        queries?.transaction {
            queries?.deleteAllTracks()
            for (t in stamped) {
                queries?.upsertTrack(
                    id = t.id,
                    file_key = t.fileKey,
                    drive_file_id = t.driveFileId,
                    folder_name = t.folderName,
                    relative_path = t.relativePath,
                    is_missing = if (t.isMissingOnDevice) 1L else 0L,
                    updated_at = t.updatedAt ?: 0L,
                    added_at = t.addedAt,
                    payload_json = json.encodeToString(t),
                )
            }
        }
    }

    fun setPlaylists(next: List<Playlist>, now: Long = currentTimeMillis()) {
        val stamped = LibraryMerge.stampEditedPlaylists(_playlists.value, next, now)
        _playlists.value = stamped
        queries?.transaction {
            queries?.deleteAllPlaylists()
            for (p in stamped) {
                queries?.upsertPlaylist(p.id, p.updatedAt, json.encodeToString(p))
            }
        }
    }

    fun setSmartPlaylists(next: List<SmartPlaylist>) {
        _smartPlaylists.value = next
        queries?.transaction {
            queries?.deleteAllSmartPlaylists()
            for (s in next) queries?.upsertSmartPlaylist(s.id, s.updatedAt, json.encodeToString(s))
        }
    }

    fun appendSyncEvent(event: SyncEvent) {
        val next = (listOf(event) + _syncHistory.value).take(LibraryMerge.SYNC_HISTORY_LIMIT)
        _syncHistory.value = next
        queries?.upsertSyncEvent(event.id, event.timestamp, json.encodeToString(event))
    }

    fun appendScanLog(entry: ScanLogEntry) {
        val next = (listOf(entry) + _scanLogs.value).take(200)
        _scanLogs.value = next
        queries?.upsertScanLog(entry.id, entry.startedAt, json.encodeToString(entry))
    }

    fun clearScanLogs() {
        _scanLogs.value = emptyList()
        queries?.deleteAllScanLogs()
    }

    fun upsertWatchedFolder(record: WatchedFolderRecord) {
        val next = (_watchedFolders.value.filterNot { it.name == record.name } + record).sortedBy { it.name.lowercase() }
        _watchedFolders.value = next
        queries?.upsertWatchedFolder(record.name, record.lastScannedAt, json.encodeToString(record))
    }

    fun removeWatchedFolder(name: String) {
        _watchedFolders.value = _watchedFolders.value.filterNot { it.name == name }
        queries?.deleteWatchedFolder(name)
    }

    fun setFolderMappings(mappings: List<DriveFolderMapping>, tombstones: List<FolderMappingTombstone> = _folderMappingTombstones.value) {
        _folderMappings.value = mappings
        _folderMappingTombstones.value = tombstones
        queries?.transaction {
            queries?.deleteAllFolderMappings()
            for (m in mappings) queries?.upsertFolderMapping(m.driveFolderId, m.updatedAt, json.encodeToString(m))
            queries?.deleteTombstonesByCategory("folder-mapping")
            for (t in tombstones) {
                queries?.upsertTombstone("${t.driveFolderId}::${t.deviceId ?: "*"}", "folder-mapping", t.deletedAt, json.encodeToString(t))
            }
        }
    }

    fun setLibraryTombstones(tombstones: List<LibraryTombstone>) {
        _libraryTombstones.value = tombstones
        queries?.transaction {
            queries?.deleteTombstonesByCategory("library")
            for (t in tombstones) {
                val prefix = when (t) {
                    is LibraryTombstone.Track -> "track"
                    is LibraryTombstone.PlaylistTombstone -> "playlist"
                    is LibraryTombstone.SmartPlaylistTombstone -> "smart-playlist"
                }
                queries?.upsertTombstone("$prefix:${t.id}", "library", t.deletedAt, json.encodeToString(t))
            }
        }
    }

    fun recordPlayEvent(entry: PlayHistoryEntry, updatedStats: TrackPlayStats) {
        _playStats.value = _playStats.value + (entry.trackId to updatedStats)
        _playHistory.value = (listOf(entry) + _playHistory.value).take(2000)
        queries?.upsertPlayStats(
            entry.trackId,
            updatedStats.playCount.toLong(),
            updatedStats.completedCount.toLong(),
            updatedStats.skipCount.toLong(),
            updatedStats.lastPlayedAt,
        )
        queries?.upsertPlayHistory(entry.id, entry.playedAt, json.encodeToString(entry))
    }

    fun saveLoudness(trackKey: String, data: TrackLoudnessData) {
        val next = (_loudnessCache.value + (trackKey to data))
            .entries.sortedByDescending { it.value.analyzedAt }.take(600)
            .associate { it.key to it.value }
        _loudnessCache.value = next
        queries?.upsertLoudness(trackKey, data.integratedLufs, data.peak, data.analyzedAt, data.album)
    }

    fun updateTransitionSettings(settings: PlaybackTransitionSettings) {
        _transitionSettings.value = settings
        queries?.upsertKv("transition_settings", json.encodeToString(settings))
    }

    fun updateReplayGainSettings(settings: ReplayGainSettings) {
        _replayGainSettings.value = settings
        queries?.upsertKv("replaygain_settings", json.encodeToString(settings))
    }

    fun saveDashboardFilter(filter: SavedDashboardFilter) {
        val next = listOf(filter) + _savedDashboardFilters.value.filterNot { it.id == filter.id }
        _savedDashboardFilters.value = next
        queries?.upsertKv("dashboard_filters", json.encodeToString(next))
    }

    fun deleteDashboardFilter(id: String) {
        val next = _savedDashboardFilters.value.filterNot { it.id == id }
        _savedDashboardFilters.value = next
        queries?.upsertKv("dashboard_filters", json.encodeToString(next))
    }

    fun recordSearchedTracks(trackIds: List<String>, now: Long = currentTimeMillis()) {
        val next = _bulkSearchMemory.value.toMutableMap()
        for (id in trackIds) next[id] = now
        _bulkSearchMemory.value = next
        queries?.upsertKv("bulk_search_memory", json.encodeToString(next))
    }

    fun renameCurrentDevice(newName: String) {
        val updated = _currentDevice.value.copy(name = newName.trim().ifEmpty { "${_currentDevice.value.platform} Player" }, lastSeenAt = currentTimeMillis())
        _currentDevice.value = updated
        _knownDevices.value = listOf(updated) + _knownDevices.value.filterNot { it.id == updated.id }
        queries?.upsertKv("device_profile", json.encodeToString(updated))
    }

    fun setKnownDevices(devices: List<SyncDeviceProfile>) {
        _knownDevices.value = devices
    }
}
