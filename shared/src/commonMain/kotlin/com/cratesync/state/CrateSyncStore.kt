package com.cratesync.state

import com.cratesync.ai.AiProxyClient
import com.cratesync.core.BinaryAudioParser
import com.cratesync.core.DuplicateDetector
import com.cratesync.core.FolderMappingMerge
import com.cratesync.core.FolderMappingState
import com.cratesync.core.LibraryMerge
import com.cratesync.core.LibrarySnapshot
import com.cratesync.core.ScanLogFormatter
import com.cratesync.core.ScanMatchResult
import com.cratesync.core.ScanMatcher
import com.cratesync.core.ScannedFile
import com.cratesync.core.SyncEngine
import com.cratesync.core.extractAudioFormat
import com.cratesync.core.linkDriveSongToLocalFile
import com.cratesync.drive.DriveFairDfsFolderCounter
import com.cratesync.drive.DriveFolderCountStats
import com.cratesync.drive.DriveFolderItem
import com.cratesync.drive.DriveFolderScope
import com.cratesync.drive.DriveManifest
import com.cratesync.drive.GoogleDriveApiClient
import com.cratesync.model.AppToast
import com.cratesync.model.ConfirmationRequest
import com.cratesync.model.DeviceFolderBinding
import com.cratesync.model.DirectoryWatcherStatus
import com.cratesync.model.DriveFolderMapping
import com.cratesync.model.FolderMappingTombstone
import com.cratesync.model.FolderSyncDirection
import com.cratesync.model.GenreClassifyInput
import com.cratesync.model.LibraryTombstone
import com.cratesync.model.LocalTrack
import com.cratesync.model.MatchStatus
import com.cratesync.model.Playlist
import com.cratesync.model.ScanLogEntry
import com.cratesync.model.ScanLogStatus
import com.cratesync.model.ScanTriggerSource
import com.cratesync.model.SmartPlaylist
import com.cratesync.model.SyncRule
import com.cratesync.model.ToastLevel
import com.cratesync.model.TrackLookupInput
import com.cratesync.model.WatchedFolderRecord
import com.cratesync.model.WorkspaceView
import com.cratesync.platform.FolderScanBatch
import com.cratesync.platform.PlatformAuth
import com.cratesync.platform.PlatformFileSystem
import com.cratesync.platform.PlatformUrlOpener
import com.cratesync.platform.currentTimeMillis
import com.cratesync.platform.randomUuid
import com.cratesync.youtube.MatchProposal
import com.cratesync.youtube.MatchRefresh
import com.cratesync.youtube.YouTubeApi
import com.cratesync.youtube.YouTubeBulkMatch
import com.cratesync.youtube.YouTubePush
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class CrateSyncUiState(
    val activeView: WorkspaceView = WorkspaceView.DASHBOARD,
    val selectedPlaylistId: String? = null,
    val selectedSmartPlaylistId: String? = null,
    val watcherStatus: DirectoryWatcherStatus = DirectoryWatcherStatus.IDLE,
    val watcherIntervalMinutes: Int = 5,
    val isScanning: Boolean = false,
    val scanProgressLabel: String = "",
    val inspectedTrackId: String? = null,
    val isSmartSearchOpen: Boolean = false,
    val isBulkMatchOpen: Boolean = false,
    val pushDialogPlaylistId: String? = null,
    val isDriveBrowserOpen: Boolean = false,
    val driveScope: DriveFolderScope = DriveFolderScope.MY_DRIVE,
    val driveFolders: List<DriveFolderItem> = emptyList(),
    val driveFolderStats: Map<String, DriveFolderCountStats> = emptyMap(),
    val hideZeroAudioDriveFolders: Boolean = false,
    val isIndexingDrive: Boolean = false,
    val toasts: List<AppToast> = emptyList(),
    val pendingConfirmation: ConfirmationRequest? = null,
)

/**
 * Unidirectional application store coordinating all 7 CrateSync workspaces, multi-folder watcher,
 * scan logs, Drive Source-of-Truth sync, YouTube bulk matching/push, and AI enrichment.
 */
class CrateSyncStore(
    val scope: CoroutineScope,
    val repository: LibraryRepository,
    val playback: PlaybackController,
    val fileSystem: PlatformFileSystem,
    val auth: PlatformAuth,
    val driveClient: GoogleDriveApiClient,
    val youtubeApi: YouTubeApi,
    val aiClient: AiProxyClient,
    val urlOpener: PlatformUrlOpener,
) {
    private val _ui = MutableStateFlow(CrateSyncUiState())
    val ui: StateFlow<CrateSyncUiState> = _ui.asStateFlow()

    private val driveCounter = DriveFairDfsFolderCounter(driveClient)
    private var watcherJob: Job? = null

    init {
        refreshWatcherLoop()
    }

    fun navigate(view: WorkspaceView, playlistId: String? = null, smartPlaylistId: String? = null) {
        _ui.value = _ui.value.copy(
            activeView = view,
            selectedPlaylistId = playlistId ?: _ui.value.selectedPlaylistId,
            selectedSmartPlaylistId = smartPlaylistId ?: _ui.value.selectedSmartPlaylistId,
        )
    }

    fun showToast(message: String, level: ToastLevel = ToastLevel.INFO) {
        val toast = AppToast(randomUuid(), message, level)
        _ui.value = _ui.value.copy(toasts = (_ui.value.toasts + toast).takeLast(4))
        scope.launch {
            delay(4500L)
            dismissToast(toast.id)
        }
    }

    fun dismissToast(id: String) {
        _ui.value = _ui.value.copy(toasts = _ui.value.toasts.filterNot { it.id == id })
    }

    fun requestConfirmation(
        title: String,
        message: String,
        confirmLabel: String,
        isDestructive: Boolean = false,
        showYouTubeLegalNotice: Boolean = false,
        onConfirm: () -> Unit,
    ) {
        _ui.value = _ui.value.copy(
            pendingConfirmation = ConfirmationRequest(
                id = randomUuid(),
                title = title,
                message = message,
                confirmLabel = confirmLabel,
                isDestructive = isDestructive,
                showYouTubeLegalNotice = showYouTubeLegalNotice,
                onConfirm = {
                    _ui.value = _ui.value.copy(pendingConfirmation = null)
                    onConfirm()
                },
            )
        )
    }

    fun dismissConfirmation() {
        _ui.value = _ui.value.copy(pendingConfirmation = null)
    }

    fun setSmartSearchOpen(open: Boolean) { _ui.value = _ui.value.copy(isSmartSearchOpen = open) }
    fun setBulkMatchOpen(open: Boolean) { _ui.value = _ui.value.copy(isBulkMatchOpen = open) }
    fun openPushDialog(playlistId: String?) { _ui.value = _ui.value.copy(pushDialogPlaylistId = playlistId) }
    fun inspectTrack(trackId: String?) { _ui.value = _ui.value.copy(inspectedTrackId = trackId) }

    fun setWatcherInterval(minutes: Int) {
        _ui.value = _ui.value.copy(watcherIntervalMinutes = minutes.coerceAtLeast(0))
        refreshWatcherLoop()
    }

    private fun refreshWatcherLoop() {
        watcherJob?.cancel()
        val folders = repository.watchedFolders.value
        val interval = _ui.value.watcherIntervalMinutes
        if (folders.isEmpty() || interval <= 0) {
            _ui.value = _ui.value.copy(watcherStatus = DirectoryWatcherStatus.IDLE)
            return
        }
        val anyLive = folders.any { it.hasLiveAccess }
        _ui.value = _ui.value.copy(
            watcherStatus = if (anyLive) DirectoryWatcherStatus.WATCHING else DirectoryWatcherStatus.PAUSED
        )
        if (!anyLive) return
        watcherJob = scope.launch {
            while (isActive) {
                delay(interval * 60_000L)
                rescanAllWatchedFolders(ScanTriggerSource.BACKGROUND_WATCH)
            }
        }
    }

    fun pickAndScanFolder() {
        scope.launch {
            _ui.value = _ui.value.copy(isScanning = true, watcherStatus = DirectoryWatcherStatus.SYNCING, scanProgressLabel = "Scanning folder…")
            val batch = runCatching { fileSystem.pickAndScanFolder() }.getOrNull()
            if (batch != null) {
                ingestFolderScanBatch(batch, ScanTriggerSource.MANUAL_FOLDER)
            } else {
                _ui.value = _ui.value.copy(isScanning = false, scanProgressLabel = "")
                refreshWatcherLoop()
            }
        }
    }

    fun rescanAllWatchedFolders(source: ScanTriggerSource = ScanTriggerSource.MANUAL_FOLDER) {
        val folders = repository.watchedFolders.value
        if (folders.isEmpty()) {
            showToast("No watched folders mounted yet.", ToastLevel.WARNING)
            return
        }
        scope.launch {
            _ui.value = _ui.value.copy(isScanning = true, watcherStatus = DirectoryWatcherStatus.SYNCING)
            for (folder in folders) {
                _ui.value = _ui.value.copy(scanProgressLabel = "Re-scanning ${folder.name}…")
                val batch = runCatching { fileSystem.rescanFolder(folder.name, folder.nativePathOrUri) }.getOrNull()
                if (batch != null) ingestFolderScanBatch(batch, source)
            }
            _ui.value = _ui.value.copy(isScanning = false, scanProgressLabel = "")
            refreshWatcherLoop()
        }
    }

    private suspend fun ingestFolderScanBatch(batch: FolderScanBatch, source: ScanTriggerSource) {
        val startedAt = currentTimeMillis()
        val existingTracks = repository.tracks.value
        val offlineKeys = buildSet {
            for (track in existingTracks) {
                if (fileSystem.hasOfflineAudio(track.fileKey)) add(track.fileKey)
            }
        }
        val matcher = ScanMatcher(existingTracks) { key -> key in offlineKeys }
        val updatedById = existingTracks.associateBy { it.id }.toMutableMap()
        val scannedFileKeys = mutableSetOf<String>()

        var added = 0
        var updated = 0
        var restored = 0

        for (file in batch.audioFiles) {
            val scanned = ScannedFile(file.name, file.size, file.relativePath)
            val key = "${file.relativePath.lowercase()}::${file.size}"
            scannedFileKeys += key
            val parsed = if (file.headBytes != null) {
                BinaryAudioParser.parseHeaderAndTail(file.headBytes, file.tailBytes, file.size, file.name)
            } else {
                BinaryAudioParser.applyFileNameFallback(com.cratesync.core.ParsedAudioTags(), file.name)
            }

            when (val match = matcher.match(scanned)) {
                is ScanMatchResult.Known -> {
                    val prev = match.track
                    if (prev.isMissingOnDevice) restored++ else updated++
                    updatedById[prev.id] = prev.copy(
                        lastSeenAt = startedAt,
                        isMissingOnDevice = false,
                        duration = if (prev.duration <= 0.0 && parsed.durationSeconds > 0.0) parsed.durationSeconds else prev.duration,
                    )
                }
                is ScanMatchResult.DriveCopy -> {
                    restored++
                    updatedById[match.track.id] = linkDriveSongToLocalFile(match.track, scanned).copy(lastSeenAt = startedAt)
                }
                ScanMatchResult.New -> {
                    added++
                    val id = randomUuid()
                    updatedById[id] = LocalTrack(
                        id = id,
                        fileKey = key,
                        fileName = file.name,
                        relativePath = file.relativePath,
                        folderName = batch.folderName,
                        title = parsed.title ?: file.name.substringBeforeLast('.'),
                        artist = parsed.artist ?: "Unknown Artist",
                        album = parsed.album ?: "Unknown Album",
                        genre = parsed.genre,
                        year = parsed.year.orEmpty(),
                        trackNumber = parsed.trackNumber,
                        duration = parsed.durationSeconds,
                        format = extractAudioFormat(file.name),
                        fileSize = file.size,
                        addedAt = startedAt,
                        lastSeenAt = startedAt,
                        isMissingOnDevice = false,
                    )
                }
            }
        }

        // Only mark missing tracks belonging to this watched folder when absent from this scan
        var missingCount = 0
        for ((id, track) in updatedById) {
            if (track.folderName == batch.folderName && track.fileKey !in scannedFileKeys && !track.isMissingOnDevice) {
                updatedById[id] = track.copy(isMissingOnDevice = true)
                missingCount++
            }
        }

        val completedAt = currentTimeMillis()
        val finalTracks = updatedById.values.toList()
        repository.setTracks(finalTracks, completedAt)
        repository.setPlaylists(SyncEngine.applySyncRulesToPlaylists(repository.playlists.value, finalTracks, completedAt), completedAt)
        repository.upsertWatchedFolder(
            WatchedFolderRecord(
                name = batch.folderName,
                nativePathOrUri = batch.nativePathOrUri,
                lastScannedAt = completedAt,
                fileKeys = scannedFileKeys,
                hasLiveAccess = true,
            )
        )
        repository.appendScanLog(
            ScanLogEntry(
                id = randomUuid(),
                startedAt = startedAt,
                completedAt = completedAt,
                durationMs = (completedAt - startedAt).coerceAtLeast(1L),
                source = source,
                folderName = batch.folderName,
                totalFilesEncountered = batch.totalFilesEncountered,
                audioFilesProcessed = batch.audioFiles.size,
                addedCount = added,
                updatedCount = updated,
                restoredCount = restored,
                missingCount = missingCount,
                skippedNonAudioCount = batch.skippedNonAudioCount,
                status = if (batch.errors.isEmpty()) ScanLogStatus.COMPLETED else ScanLogStatus.COMPLETED_WITH_ERRORS,
                errors = batch.errors,
            )
        )
        _ui.value = _ui.value.copy(isScanning = false, scanProgressLabel = "")
        refreshWatcherLoop()
        showToast("Indexed ${batch.folderName}: +$added added, $restored restored, $missingCount missing.", ToastLevel.SUCCESS)
    }

    fun createPlaylist(name: String, description: String = "", initialTrackIds: List<String> = emptyList()) {
        val now = currentTimeMillis()
        val pl = Playlist(
            id = randomUuid(),
            name = name.trim().ifEmpty { "Untitled Crate" },
            description = description.trim(),
            createdAt = now,
            updatedAt = now,
            trackIds = initialTrackIds.distinct(),
            syncRule = SyncRule(),
        )
        repository.setPlaylists(listOf(pl) + repository.playlists.value, now)
        navigate(WorkspaceView.PLAYLIST, playlistId = pl.id)
        showToast("Created playlist \"${pl.name}\".", ToastLevel.SUCCESS)
    }

    fun deletePlaylistWithConfirmation(playlist: Playlist) {
        requestConfirmation(
            title = "Delete Playlist",
            message = "Delete \"${playlist.name}\"? A tombstone will be recorded so Drive sync won't restore it.",
            confirmLabel = "Delete Playlist",
            isDestructive = true,
        ) {
            val now = currentTimeMillis()
            repository.setPlaylists(repository.playlists.value.filterNot { it.id == playlist.id }, now)
            repository.setLibraryTombstones(
                repository.libraryTombstones.value + LibraryTombstone.PlaylistTombstone(playlist.id, now)
            )
            if (_ui.value.selectedPlaylistId == playlist.id) navigate(WorkspaceView.DASHBOARD)
            showToast("Deleted \"${playlist.name}\".", ToastLevel.INFO)
        }
    }

    fun saveSmartPlaylist(smartPlaylist: SmartPlaylist) {
        val next = listOf(smartPlaylist) + repository.smartPlaylists.value.filterNot { it.id == smartPlaylist.id }
        repository.setSmartPlaylists(next)
        navigate(WorkspaceView.SMART_PLAYLIST, smartPlaylistId = smartPlaylist.id)
        showToast("Saved Smart Playlist \"${smartPlaylist.name}\".", ToastLevel.SUCCESS)
    }

    fun updateTrackMetadata(
        trackId: String,
        title: String,
        artist: String,
        album: String,
        genre: String?,
        year: String,
        youtubeVideoId: String?,
        matchStatus: MatchStatus,
    ) {
        val now = currentTimeMillis()
        val next = repository.tracks.value.map { t ->
            if (t.id != trackId) t
            else t.copy(
                title = title.trim().ifEmpty { t.title },
                artist = artist.trim().ifEmpty { t.artist },
                album = album.trim().ifEmpty { t.album },
                genre = genre?.trim()?.ifEmpty { null },
                year = year.trim(),
                youtubeVideoId = youtubeVideoId?.trim()?.ifEmpty { null },
                matchStatus = matchStatus,
                updatedAt = now,
            )
        }
        repository.setTracks(next, now)
        showToast("Updated track metadata.", ToastLevel.SUCCESS)
    }

    fun removeDuplicateTracksWithConfirmation(duplicateToKeeper: Map<String, String>) {
        if (duplicateToKeeper.isEmpty()) return
        requestConfirmation(
            title = "Remove Duplicate Entries",
            message = "Remove ${duplicateToKeeper.size} duplicate catalog entries and remap all playlist references to the highest-quality keepers?",
            confirmLabel = "Remove Duplicates",
            isDestructive = true,
        ) {
            val now = currentTimeMillis()
            val res = DuplicateDetector.removeDuplicatesWithRemap(
                repository.tracks.value,
                repository.playlists.value,
                duplicateToKeeper,
                now,
            )
            repository.setTracks(res.remainingTracks, now)
            repository.setPlaylists(res.updatedPlaylists, now)
            repository.setLibraryTombstones(
                repository.libraryTombstones.value + res.removedTracks.map { LibraryMerge.trackTombstone(it, now) }
            )
            showToast("Removed ${res.removedTracks.size} duplicates and remapped ${res.remappedReferences} playlist references.", ToastLevel.SUCCESS)
        }
    }

    fun applyBulkMatchProposals(proposals: List<MatchProposal>, fromYouTubeApi: Boolean) {
        val now = currentTimeMillis()
        val (nextTracks, count) = YouTubeBulkMatch.applyMatches(
            repository.tracks.value,
            proposals,
            checkedAt = if (fromYouTubeApi) now else null,
        )
        repository.setTracks(nextTracks, now)
        showToast("Matched $count tracks to YouTube Music.", ToastLevel.SUCCESS)
    }

    fun pushPlaylistToYouTubeWithConfirmation(playlist: Playlist) {
        val byId = repository.tracks.value.associateBy { it.id }
        val tracks = playlist.trackIds.mapNotNull { byId[it] }
        val est = YouTubePush.estimate(playlist, tracks)
        requestConfirmation(
            title = "Push \"${playlist.name}\" to YouTube",
            message = "Will send ${est.sendCount} songs, remove ${est.removeCount}, reorder ${est.moveCount} (~${est.quotaUnits} quota units).",
            confirmLabel = "Push to YouTube",
            showYouTubeLegalNotice = true,
        ) {
            scope.launch {
                val now = currentTimeMillis()
                // Run mandatory 30-day match freshness check before pushing
                val refreshOutcome = MatchRefresh.refreshMatches(youtubeApi, tracks, now)
                val (refreshedLibrary, cleared) = MatchRefresh.applyRefresh(repository.tracks.value, refreshOutcome, now)
                if (cleared > 0) {
                    repository.setTracks(refreshedLibrary, now)
                    showToast("Cleared $cleared unavailable YouTube matches during 30-day verification.", ToastLevel.WARNING)
                }
                val freshMap = refreshedLibrary.associateBy { it.id }
                val freshTracks = playlist.trackIds.mapNotNull { freshMap[it] }
                val outcome = YouTubePush.push(youtubeApi, playlist, freshTracks, now)
                val updatedPl = YouTubePush.applyOutcomeToPlaylist(playlist, outcome, now, freshMap)
                repository.setPlaylists(repository.playlists.value.map { if (it.id == updatedPl.id) updatedPl else it }, now)
                val diff = SyncEngine.computePlaylistDiff(updatedPl, freshMap)
                repository.appendSyncEvent(SyncEngine.createSyncEvent(updatedPl, diff, now))
                showToast(
                    outcome.stoppedMessage ?: "Pushed +${outcome.inserted.size} / -${outcome.removed.size} / ~${outcome.moved.size} to YouTube.",
                    if (outcome.stoppedMessage == null) ToastLevel.SUCCESS else ToastLevel.WARNING,
                )
            }
        }
    }

    fun openDriveBrowser(scopeMode: DriveFolderScope = DriveFolderScope.MY_DRIVE) {
        _ui.value = _ui.value.copy(isDriveBrowserOpen = true, driveScope = scopeMode, isIndexingDrive = true)
        scope.launch {
            runCatching {
                val folders = driveClient.listFolders("root", scopeMode)
                _ui.value = _ui.value.copy(driveFolders = folders)
                driveCounter.countFolderStats(folders) { stats ->
                    _ui.value = _ui.value.copy(driveFolderStats = stats)
                }
            }.onFailure { err ->
                showToast(err.message ?: "Unable to browse Google Drive folders.", ToastLevel.ERROR)
            }
            _ui.value = _ui.value.copy(isIndexingDrive = false)
        }
    }

    fun closeDriveBrowser() { _ui.value = _ui.value.copy(isDriveBrowserOpen = false) }
    fun toggleHideZeroAudioDriveFolders() {
        _ui.value = _ui.value.copy(hideZeroAudioDriveFolders = !_ui.value.hideZeroAudioDriveFolders)
    }

    fun bindDriveFolderMapping(driveFolder: DriveFolderItem, localPath: String, direction: FolderSyncDirection, autoCache: Boolean) {
        val now = currentTimeMillis()
        val devId = repository.currentDevice.value.id
        val existing = repository.folderMappings.value.firstOrNull { it.driveFolderId == driveFolder.id }
        val binding = DeviceFolderBinding(devId, FolderMappingMerge.normalizeFolderPath(localPath), direction, autoCache, null, now)
        val updated = existing?.copy(
            driveFolderName = driveFolder.name,
            updatedAt = now,
            deviceBindings = existing.deviceBindings + (devId to binding),
        ) ?: DriveFolderMapping(
            id = randomUuid(),
            driveFolderId = driveFolder.id,
            driveFolderName = driveFolder.name,
            createdAt = now,
            updatedAt = now,
            deviceBindings = mapOf(devId to binding),
        )
        val next = listOf(updated) + repository.folderMappings.value.filterNot { it.driveFolderId == driveFolder.id }
        repository.setFolderMappings(next)
        showToast("Mapped Drive folder \"${driveFolder.name}\" to local path.", ToastLevel.SUCCESS)
    }

    fun removeFolderMappingWithConfirmation(mapping: DriveFolderMapping) {
        requestConfirmation(
            title = "Remove Drive Folder Mapping",
            message = "Remove mapping for \"${mapping.driveFolderName}\"? A tombstone will prevent older manifests from restoring it.",
            confirmLabel = "Remove Mapping",
            isDestructive = true,
        ) {
            val now = currentTimeMillis()
            val tomb = FolderMappingTombstone(mapping.driveFolderId, null, now)
            repository.setFolderMappings(
                repository.folderMappings.value.filterNot { it.driveFolderId == mapping.driveFolderId },
                repository.folderMappingTombstones.value + tomb,
            )
            showToast("Removed mapping for \"${mapping.driveFolderName}\".", ToastLevel.INFO)
        }
    }

    fun pushManifestToDriveWithConfirmation() {
        requestConfirmation(
            title = "Push Library to Google Drive",
            message = "Merge this device's tracks, playlists, folder mappings, and tombstones with cratesync-source-of-truth.json on Google Drive?",
            confirmLabel = "Merge & Push to Drive",
        ) {
            scope.launch {
                runCatching {
                    val now = currentTimeMillis()
                    val existingFileId = driveClient.findManifestFileId()
                    val remoteManifest = existingFileId?.let { driveClient.downloadManifest(it) }
                    val localSnap = LibrarySnapshot(
                        repository.tracks.value,
                        repository.playlists.value,
                        repository.smartPlaylists.value,
                        repository.syncHistory.value,
                        repository.libraryTombstones.value,
                    )
                    val remoteSnap = remoteManifest?.let {
                        LibrarySnapshot(it.tracks, it.playlists, it.smartPlaylists, it.syncHistory, it.tombstones)
                    }
                    val mergedLib = LibraryMerge.mergeLibraryForPush(localSnap, remoteSnap, { !it.isMissingOnDevice }, now)
                    val mergedFolders = FolderMappingMerge.mergeFolderMappingState(
                        FolderMappingState(repository.folderMappings.value, repository.folderMappingTombstones.value),
                        FolderMappingState(remoteManifest?.folderMappings.orEmpty(), remoteManifest?.folderMappingTombstones.orEmpty()),
                        repository.currentDevice.value.id,
                        now,
                    )
                    val devices = FolderMappingMerge.mergeDeviceProfiles(
                        repository.knownDevices.value,
                        remoteManifest?.devices.orEmpty(),
                        repository.currentDevice.value,
                    )
                    val manifest = DriveManifest(
                        exportedAt = now,
                        sourceDeviceId = repository.currentDevice.value.id,
                        tracks = mergedLib.library.tracks,
                        playlists = mergedLib.library.playlists,
                        smartPlaylists = mergedLib.library.smartPlaylists,
                        syncHistory = mergedLib.library.syncHistory,
                        tombstones = mergedLib.library.tombstones,
                        devices = devices,
                        folderMappings = mergedFolders.folderMappings,
                        folderMappingTombstones = mergedFolders.folderMappingTombstones,
                    )
                    driveClient.uploadManifest(manifest, existingFileId = existingFileId)
                    repository.setTracks(manifest.tracks, now)
                    repository.setPlaylists(manifest.playlists, now)
                    repository.setSmartPlaylists(manifest.smartPlaylists)
                    repository.setLibraryTombstones(manifest.tombstones)
                    repository.setFolderMappings(manifest.folderMappings, manifest.folderMappingTombstones)
                    repository.setKnownDevices(devices)
                    showToast("Synced ${manifest.tracks.size} tracks & ${manifest.playlists.size} playlists to Google Drive.", ToastLevel.SUCCESS)
                }.onFailure { err ->
                    showToast(err.message ?: "Google Drive push failed.", ToastLevel.ERROR)
                }
            }
        }
    }

    fun enrichMetadataWithAi(tracks: List<LocalTrack>) {
        val batch = tracks.take(25)
        if (batch.isEmpty()) return
        scope.launch {
            runCatching {
                val inputs = batch.map {
                    TrackLookupInput(it.id, it.fileName, it.relativePath, it.folderName, it.title, it.artist, it.album, it.year, it.duration)
                }
                val resp = aiClient.suggestMetadata(inputs)
                val byId = resp.suggestions.associateBy { it.trackId }
                val now = currentTimeMillis()
                val next = repository.tracks.value.map { t ->
                    val s = byId[t.id] ?: return@map t
                    t.copy(
                        title = s.title.ifBlank { t.title },
                        artist = s.artist.ifBlank { t.artist },
                        album = s.album.ifBlank { t.album },
                        year = s.year.ifBlank { t.year },
                        updatedAt = now,
                    )
                }
                repository.setTracks(next, now)
                showToast("Enriched metadata for ${resp.suggestions.size} tracks via Google Search grounding.", ToastLevel.SUCCESS)
            }.onFailure { err ->
                showToast(err.message ?: "AI metadata lookup failed.", ToastLevel.ERROR)
            }
        }
    }

    fun classifyGenresWithAi(tracks: List<LocalTrack>) {
        val batch = tracks.take(60)
        if (batch.isEmpty()) return
        scope.launch {
            runCatching {
                val inputs = batch.map {
                    GenreClassifyInput(it.id, it.title, it.artist, it.album, it.fileName, it.relativePath, it.folderName, it.year, it.duration, it.genre.orEmpty())
                }
                val resp = aiClient.classifyGenres(inputs)
                val byId = resp.classifications.associateBy { it.trackId }
                val now = currentTimeMillis()
                val next = repository.tracks.value.map { t ->
                    val c = byId[t.id] ?: return@map t
                    t.copy(genre = c.genre, updatedAt = now)
                }
                repository.setTracks(next, now)
                showToast("Classified genres for ${resp.classifications.size} tracks.", ToastLevel.SUCCESS)
            }.onFailure { err ->
                showToast(err.message ?: "AI genre classification failed.", ToastLevel.ERROR)
            }
        }
    }

    fun exportScanLogsJson() {
        scope.launch {
            val payload = ScanLogFormatter.exportJson(repository.scanLogs.value)
            val saved = fileSystem.exportTextFile("cratesync-scan-logs.json", payload, "application/json")
            showToast(if (saved) "Exported scan logs JSON." else "Scan log export cancelled.", ToastLevel.INFO)
        }
    }
}
