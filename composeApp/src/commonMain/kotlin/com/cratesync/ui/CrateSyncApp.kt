package com.cratesync.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.cratesync.core.SyncEngine
import com.cratesync.model.ToastLevel
import com.cratesync.model.WorkspaceView
import com.cratesync.state.CrateSyncStore
import com.cratesync.ui.components.AdaptiveShell
import com.cratesync.ui.components.BulkMatchDialog
import com.cratesync.ui.components.ConfirmationModal
import com.cratesync.ui.components.DriveFolderBrowserDialog
import com.cratesync.ui.components.MiniPlayerBar
import com.cratesync.ui.components.SmartSearchDialog
import com.cratesync.ui.components.ToastOverlay
import com.cratesync.ui.components.TrackMatchEditorDialog
import com.cratesync.ui.screens.DashboardScreen
import com.cratesync.ui.screens.DeviceStorageScreen
import com.cratesync.ui.screens.DriveTransferScreen
import com.cratesync.ui.screens.PlaylistScreen
import com.cratesync.ui.screens.ScanLogsScreen
import com.cratesync.ui.screens.SmartPlaylistScreen
import com.cratesync.ui.screens.SyncQueueScreen
import com.cratesync.ui.theme.CrateSyncTheme
import com.cratesync.youtube.YouTubeLinks
import kotlinx.coroutines.launch

@Composable
fun CrateSyncApp(store: CrateSyncStore) {
    val ui by store.ui.collectAsState()
    val tracks by store.repository.tracks.collectAsState()
    val playlists by store.repository.playlists.collectAsState()
    val smartPlaylists by store.repository.smartPlaylists.collectAsState()
    val syncHistory by store.repository.syncHistory.collectAsState()
    val scanLogs by store.repository.scanLogs.collectAsState()
    val watchedFolders by store.repository.watchedFolders.collectAsState()
    val folderMappings by store.repository.folderMappings.collectAsState()
    val playStats by store.repository.playStats.collectAsState()
    val playHistory by store.repository.playHistory.collectAsState()
    val savedFilters by store.repository.savedDashboardFilters.collectAsState()
    val transitionSettings by store.repository.transitionSettings.collectAsState()
    val replayGainSettings by store.repository.replayGainSettings.collectAsState()
    val currentDevice by store.repository.currentDevice.collectAsState()
    val knownDevices by store.repository.knownDevices.collectAsState()
    val playback by store.playback.state.collectAsState()
    val user by store.auth.user.collectAsState()

    val trackById = remember(tracks) { tracks.associateBy { it.id } }
    val pendingDiffCount = remember(playlists, trackById) {
        playlists.count { SyncEngine.computePlaylistDiff(it, trackById).hasChanges }
    }

    CrateSyncTheme {
        Box(modifier = Modifier.fillMaxSize()) {
            AdaptiveShell(
                activeView = ui.activeView,
                selectedPlaylistId = ui.selectedPlaylistId,
                selectedSmartPlaylistId = ui.selectedSmartPlaylistId,
                playlists = playlists,
                smartPlaylists = smartPlaylists,
                watcherStatus = ui.watcherStatus,
                scanProgressLabel = ui.scanProgressLabel,
                watchedFolderCount = watchedFolders.size,
                pendingDiffCount = pendingDiffCount,
                onNavigate = store::navigate,
                onOpenSearch = { store.setSmartSearchOpen(true) },
                onScanFolder = store::pickAndScanFolder,
                onCreatePlaylist = { store.createPlaylist("New Crate ${playlists.size + 1}") },
                onOpenUrl = store.urlOpener::openUrl,
                miniPlayer = {
                    MiniPlayerBar(
                        playback = playback,
                        transitionSettings = transitionSettings,
                        replayGainSettings = replayGainSettings,
                        onTogglePlay = store.playback::togglePlayPause,
                        onSkipPrev = store.playback::skipPrevious,
                        onSkipNext = store.playback::skipNext,
                        onSeek = store.playback::seekTo,
                        onVolumeChange = store.playback::setVolume,
                        onToggleShuffle = store.playback::toggleShuffle,
                        onCycleRepeat = store.playback::cycleRepeatMode,
                        onUpdateTransitions = store.repository::updateTransitionSettings,
                        onUpdateReplayGain = store.repository::updateReplayGainSettings,
                    )
                },
            ) {
                when (ui.activeView) {
                    WorkspaceView.DASHBOARD -> DashboardScreen(
                        tracks = tracks,
                        playStats = playStats,
                        playHistory = playHistory,
                        savedFilters = savedFilters,
                        onScanFolder = store::pickAndScanFolder,
                        onOpenBulkMatch = { store.setBulkMatchOpen(true) },
                        onPlayTrack = store.playback::playTrackInQueue,
                        onSaveDashboardFilter = store.repository::saveDashboardFilter,
                        onDeleteDashboardFilter = store.repository::deleteDashboardFilter,
                        onCreateSmartPlaylistFromPreset = store::saveSmartPlaylist,
                        onClassifyGenresAi = { store.classifyGenresWithAi(tracks) },
                    )

                    WorkspaceView.SCANNER -> DeviceStorageScreen(
                        tracks = tracks,
                        watchedFolders = watchedFolders,
                        onScanFolder = store::pickAndScanFolder,
                        onRescanAll = { store.rescanAllWatchedFolders() },
                        onPlayTrack = store.playback::playTrackInQueue,
                        onInspectTrack = { store.inspectTrack(it.id) },
                        onRemoveDuplicates = store::removeDuplicateTracksWithConfirmation,
                        onRemoveWatchedFolder = store.repository::removeWatchedFolder,
                        onEnrichSelectedAi = store::enrichMetadataWithAi,
                        onOpenBulkMatch = { store.setBulkMatchOpen(true) },
                    )

                    WorkspaceView.PLAYLIST -> PlaylistScreen(
                        playlist = playlists.firstOrNull { it.id == ui.selectedPlaylistId } ?: playlists.firstOrNull(),
                        tracks = tracks,
                        onPlayTrack = store.playback::playTrackInQueue,
                        onPushToYouTube = store::pushPlaylistToYouTubeWithConfirmation,
                        onDeletePlaylist = store::deletePlaylistWithConfirmation,
                        onExportM3u8 = { pl, list ->
                            store.scope.launch {
                                val m3u = SyncEngine.exportM3u8(pl, list)
                                store.fileSystem.exportTextFile("${pl.name}.m3u8", m3u, "audio/x-mpegurl")
                                store.showToast("Exported ${pl.name}.m3u8", ToastLevel.SUCCESS)
                            }
                        },
                        onInspectTrack = { store.inspectTrack(it.id) },
                    )

                    WorkspaceView.SMART_PLAYLIST -> SmartPlaylistScreen(
                        smartPlaylist = smartPlaylists.firstOrNull { it.id == ui.selectedSmartPlaylistId } ?: smartPlaylists.firstOrNull(),
                        tracks = tracks,
                        playStats = playStats,
                        onPlayTrack = store.playback::playTrackInQueue,
                        onCreateFromPreset = store::saveSmartPlaylist,
                        onConvertToPlaylist = { name, ids -> store.createPlaylist(name, "Frozen from Smart Playlist", ids) },
                    )

                    WorkspaceView.SYNC -> SyncQueueScreen(
                        playlists = playlists,
                        tracks = tracks,
                        syncHistory = syncHistory,
                        onPushPlaylist = store::pushPlaylistToYouTubeWithConfirmation,
                    )

                    WorkspaceView.SCAN_LOGS -> ScanLogsScreen(
                        scanLogs = scanLogs,
                        watcherIntervalMinutes = ui.watcherIntervalMinutes,
                        onSetWatcherInterval = store::setWatcherInterval,
                        onRescanNow = { store.rescanAllWatchedFolders() },
                        onExportJson = store::exportScanLogsJson,
                        onClearLogs = {
                            store.requestConfirmation(
                                title = "Clear Scan Logs",
                                message = "Remove all ${scanLogs.size} scan history entries from this device?",
                                confirmLabel = "Clear Logs",
                                isDestructive = true,
                            ) { store.repository.clearScanLogs() }
                        },
                    )

                    WorkspaceView.TRANSFER -> DriveTransferScreen(
                        user = user,
                        currentDevice = currentDevice,
                        knownDevices = knownDevices,
                        folderMappings = folderMappings,
                        trackCount = tracks.size,
                        onSignInDrive = {
                            store.scope.launch {
                                runCatching { store.auth.signInGoogle(requestDrive = true) }
                                    .onFailure { store.showToast(it.message ?: "Google sign-in unavailable.", ToastLevel.WARNING) }
                            }
                        },
                        onSignOut = { store.scope.launch { store.auth.signOut() } },
                        onOpenDriveBrowser = { store.openDriveBrowser() },
                        onPushManifest = store::pushManifestToDriveWithConfirmation,
                        onRemoveMapping = store::removeFolderMappingWithConfirmation,
                    )
                }
            }

            if (ui.isSmartSearchOpen) {
                SmartSearchDialog(
                    tracks = tracks,
                    playlists = playlists,
                    playStats = playStats,
                    onDismiss = { store.setSmartSearchOpen(false) },
                    onPlayTrack = store.playback::playTrackInQueue,
                    onInspectTrack = { store.inspectTrack(it.id) },
                    onOpenPlaylist = { store.navigate(WorkspaceView.PLAYLIST, playlistId = it.id) },
                )
            }

            ui.inspectedTrackId?.let { id ->
                trackById[id]?.let { track ->
                    TrackMatchEditorDialog(
                        track = track,
                        onDismiss = { store.inspectTrack(null) },
                        onSave = { t, a, al, g, y, vid, st -> store.updateTrackMetadata(track.id, t, a, al, g, y, vid, st) },
                        onEnrichAi = { store.enrichMetadataWithAi(listOf(track)) },
                        onOpenYouTubeSearch = {
                            store.urlOpener.openUrl(YouTubeLinks.buildYouTubeMusicSearchUrl("${track.artist} ${track.title}"))
                        },
                    )
                }
            }

            if (ui.isBulkMatchOpen) {
                BulkMatchDialog(
                    tracks = tracks,
                    onDismiss = { store.setBulkMatchOpen(false) },
                    onApplyProposals = store::applyBulkMatchProposals,
                )
            }

            if (ui.isDriveBrowserOpen) {
                DriveFolderBrowserDialog(
                    scope = ui.driveScope,
                    folders = ui.driveFolders,
                    stats = ui.driveFolderStats,
                    hideZeroAudio = ui.hideZeroAudioDriveFolders,
                    isIndexing = ui.isIndexingDrive,
                    onSwitchScope = { store.openDriveBrowser(it) },
                    onToggleHideZero = store::toggleHideZeroAudioDriveFolders,
                    onBindFolder = store::bindDriveFolderMapping,
                    onDismiss = store::closeDriveBrowser,
                )
            }

            ui.pendingConfirmation?.let { req ->
                ConfirmationModal(
                    request = req,
                    onDismiss = store::dismissConfirmation,
                    onOpenUrl = store.urlOpener::openUrl,
                )
            }

            ToastOverlay(
                toasts = ui.toasts,
                onDismiss = store::dismissToast,
                modifier = Modifier.align(Alignment.BottomEnd),
            )
        }
    }
}
