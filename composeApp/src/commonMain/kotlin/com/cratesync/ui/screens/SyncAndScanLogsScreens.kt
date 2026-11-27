package com.cratesync.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cratesync.core.ScanLogFormatter
import com.cratesync.core.SyncEngine
import com.cratesync.model.LocalTrack
import com.cratesync.model.Playlist
import com.cratesync.model.ScanLogEntry
import com.cratesync.model.ScanLogStatus
import com.cratesync.model.SyncEvent
import com.cratesync.ui.theme.CrateColors
import com.cratesync.ui.theme.CrateType
import com.cratesync.ui.theme.StudioPanel

@Composable
fun SyncQueueScreen(
    playlists: List<Playlist>,
    tracks: List<LocalTrack>,
    syncHistory: List<SyncEvent>,
    onPushPlaylist: (Playlist) -> Unit,
) {
    val byId = remember(tracks) { tracks.associateBy { it.id } }
    val pendingDiffs = remember(playlists, byId) {
        playlists.map { it to SyncEngine.computePlaylistDiff(it, byId) }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        StudioPanel(modifier = Modifier.weight(1f).fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Pending Playlist Sync Diffs", style = CrateType.SectionTitle)
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(pendingDiffs, key = { it.first.id }) { (pl, diff) ->
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column {
                                Text(pl.name, color = CrateColors.TextPrimary, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                                Text(
                                    "+${diff.toAdd.size} to add · -${diff.toRemove.size} to remove · ${diff.matchedCount}/${pl.trackIds.size} YT matched",
                                    style = CrateType.TabularMono,
                                    color = if (diff.hasChanges) CrateColors.Amber else CrateColors.Emerald,
                                )
                            }
                            Button(
                                onClick = { onPushPlaylist(pl) },
                                colors = ButtonDefaults.buttonColors(containerColor = CrateColors.Accent),
                            ) { Text("Push to YouTube", fontSize = 12.sp) }
                        }
                        HorizontalDivider(color = CrateColors.BorderHairline)
                    }
                }
            }
        }

        StudioPanel(modifier = Modifier.weight(0.8f).fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Sync History (${syncHistory.size})", style = CrateType.SectionTitle)
                LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(syncHistory, key = { it.id }) { evt ->
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(evt.playlistName, color = CrateColors.TextPrimary, fontSize = 12.sp)
                            Text(evt.summary, style = CrateType.TabularMono)
                        }
                        HorizontalDivider(color = CrateColors.BorderHairline)
                    }
                }
            }
        }
    }
}

@Composable
fun ScanLogsScreen(
    scanLogs: List<ScanLogEntry>,
    watcherIntervalMinutes: Int,
    onSetWatcherInterval: (Int) -> Unit,
    onRescanNow: () -> Unit,
    onExportJson: () -> Unit,
    onClearLogs: () -> Unit,
) {
    var expandedId by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        StudioPanel(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Watcher Interval:", fontSize = 12.sp, color = CrateColors.TextSecondary)
                    listOf(0 to "Off", 2 to "2m", 5 to "5m", 15 to "15m").forEach { (mins, label) ->
                        OutlinedButton(onClick = { onSetWatcherInterval(mins) }) {
                            Text(label, fontSize = 11.sp, color = if (watcherIntervalMinutes == mins) CrateColors.Accent else CrateColors.TextSecondary)
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onRescanNow) { Text("Re-scan Now", fontSize = 12.sp) }
                    OutlinedButton(onClick = onExportJson) { Text("Export JSON", fontSize = 12.sp) }
                    TextButton(onClick = onClearLogs) { Text("Clear", color = CrateColors.CrimsonError, fontSize = 12.sp) }
                }
            }
        }

        StudioPanel(modifier = Modifier.weight(1f).fillMaxWidth()) {
            if (scanLogs.isEmpty()) {
                Column(modifier = Modifier.padding(24.dp)) {
                    Text("No file system scans logged yet.", style = CrateType.SectionTitle)
                    Text("Scan a folder to inspect timestamps, processed file counts, duration, and per-path error diagnostics.", fontSize = 12.sp, color = CrateColors.TextSecondary)
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize().padding(12.dp)) {
                    items(scanLogs, key = { it.id }) { log ->
                        val statusColor = when (log.status) {
                            ScanLogStatus.COMPLETED -> CrateColors.Emerald
                            ScanLogStatus.COMPLETED_WITH_ERRORS -> CrateColors.Amber
                            ScanLogStatus.FAILED -> CrateColors.CrimsonError
                        }
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { expandedId = if (expandedId == log.id) null else log.id }
                                .padding(vertical = 8.dp, horizontal = 6.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("${log.folderName} · ${log.source.name}", color = CrateColors.TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                Text(
                                    "${log.status.name} · ${ScanLogFormatter.formatDuration(log.durationMs)}",
                                    style = CrateType.TabularMono,
                                    color = statusColor,
                                )
                            }
                            Text(
                                "${log.audioFilesProcessed} audio / ${log.totalFilesEncountered} total · +${log.addedCount} added · ${log.restoredCount} restored · ${log.missingCount} missing · ${log.errors.size} errors",
                                style = CrateType.TabularMono,
                            )
                            if (expandedId == log.id && log.errors.isNotEmpty()) {
                                Column(modifier = Modifier.padding(top = 6.dp, start = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    log.errors.forEach { err ->
                                        Text("[${err.code.name}] ${err.path}: ${err.message}", style = CrateType.TabularMono, color = CrateColors.CrimsonError)
                                    }
                                }
                            }
                        }
                        HorizontalDivider(color = CrateColors.BorderHairline)
                    }
                }
            }
        }
    }
}
