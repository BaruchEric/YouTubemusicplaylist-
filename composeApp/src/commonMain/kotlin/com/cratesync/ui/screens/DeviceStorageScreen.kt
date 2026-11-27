package com.cratesync.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import com.cratesync.core.DuplicateDetector
import com.cratesync.core.ScanLogFormatter
import com.cratesync.core.inferTrackGenre
import com.cratesync.model.LocalTrack
import com.cratesync.model.WatchedFolderRecord
import com.cratesync.ui.theme.CrateColors
import com.cratesync.ui.theme.CrateType
import com.cratesync.ui.theme.StudioPanel

private enum class StorageToolTab { CATALOG, DUPLICATES, WATCHED_FOLDERS }

@Composable
fun DeviceStorageScreen(
    tracks: List<LocalTrack>,
    watchedFolders: List<WatchedFolderRecord>,
    onScanFolder: () -> Unit,
    onRescanAll: () -> Unit,
    onPlayTrack: (LocalTrack, List<LocalTrack>) -> Unit,
    onInspectTrack: (LocalTrack) -> Unit,
    onRemoveDuplicates: (Map<String, String>) -> Unit,
    onRemoveWatchedFolder: (String) -> Unit,
    onEnrichSelectedAi: (List<LocalTrack>) -> Unit,
    onOpenBulkMatch: () -> Unit,
) {
    var activeTab by remember { mutableStateOf(StorageToolTab.CATALOG) }
    var search by remember { mutableStateOf("") }
    val filteredTracks = remember(tracks, search) {
        if (search.isBlank()) tracks
        else {
            val q = search.trim().lowercase()
            tracks.filter {
                it.title.lowercase().contains(q) ||
                    it.artist.lowercase().contains(q) ||
                    it.album.lowercase().contains(q) ||
                    it.folderName.lowercase().contains(q)
            }
        }
    }
    val duplicateGroups = remember(tracks) { DuplicateDetector.findDuplicateGroups(tracks) }

    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StorageTabBtn("Catalog (${tracks.size})", activeTab == StorageToolTab.CATALOG) { activeTab = StorageToolTab.CATALOG }
                StorageTabBtn("Duplicates (${duplicateGroups.size})", activeTab == StorageToolTab.DUPLICATES) { activeTab = StorageToolTab.DUPLICATES }
                StorageTabBtn("Watched Folders (${watchedFolders.size})", activeTab == StorageToolTab.WATCHED_FOLDERS) { activeTab = StorageToolTab.WATCHED_FOLDERS }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onOpenBulkMatch) { Text("Bulk Match YT", fontSize = 12.sp) }
                OutlinedButton(onClick = { onEnrichSelectedAi(filteredTracks.take(25)) }) { Text("AI Tag Lookup", fontSize = 12.sp) }
                OutlinedButton(onClick = onRescanAll) { Text("Re-scan All", fontSize = 12.sp) }
                Button(onClick = onScanFolder, colors = ButtonDefaults.buttonColors(containerColor = CrateColors.Accent)) {
                    Text("Mount Folder", fontSize = 12.sp)
                }
            }
        }

        when (activeTab) {
            StorageToolTab.CATALOG -> {
                OutlinedTextField(
                    value = search,
                    onValueChange = { search = it },
                    placeholder = { Text("Filter local catalog by title, artist, album, or folder…", fontSize = 12.sp) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                StudioPanel(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    if (filteredTracks.isEmpty()) {
                        Column(modifier = Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("No local audio files matched", style = CrateType.SectionTitle)
                            Text("Mount a local music folder or clear your filter to browse tracks.", fontSize = 12.sp, color = CrateColors.TextSecondary)
                        }
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxSize().padding(12.dp)) {
                            items(filteredTracks, key = { it.id }) { track ->
                                val genre = inferTrackGenre(track).genre
                                val ytLabel = if (!track.youtubeVideoId.isNullOrBlank()) "YT Matched" else "Unmatched"
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { onPlayTrack(track, filteredTracks) }
                                        .padding(vertical = 8.dp, horizontal = 6.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = track.title,
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.Medium,
                                            color = if (track.isMissingOnDevice) CrateColors.CrimsonError else CrateColors.TextPrimary,
                                        )
                                        Text(
                                            text = "${track.artist} · ${track.album} · $genre · ${track.format} · $ytLabel",
                                            style = CrateType.TabularMono,
                                        )
                                    }
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                        Text(ScanLogFormatter.formatDurationSeconds(track.duration), style = CrateType.TabularMono)
                                        TextButton(onClick = { onInspectTrack(track) }) { Text("Match / Edit", fontSize = 11.sp) }
                                    }
                                }
                                HorizontalDivider(color = CrateColors.BorderHairline)
                            }
                        }
                    }
                }
            }

            StorageToolTab.DUPLICATES -> {
                StudioPanel(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Column {
                                Text("SHA-256 & Metadata Duplicate Finder", style = CrateType.SectionTitle)
                                Text("Automatically selects lossless / YT-matched / present copies as keepers and remaps playlist references.", fontSize = 12.sp, color = CrateColors.TextSecondary)
                            }
                            Button(
                                enabled = duplicateGroups.isNotEmpty(),
                                onClick = {
                                    val remap = buildMap {
                                        duplicateGroups.forEach { grp ->
                                            grp.duplicates.forEach { dup -> put(dup.id, grp.keeper.id) }
                                        }
                                    }
                                    onRemoveDuplicates(remap)
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = CrateColors.Accent),
                            ) {
                                Text("Clean All Duplicates")
                            }
                        }
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(duplicateGroups, key = { it.key }) { grp ->
                                Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                                    Text("Keep: ${grp.keeper.title} (${grp.keeper.format} · ${grp.keeper.relativePath})", color = CrateColors.Emerald, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                                    grp.duplicates.forEach { d ->
                                        Text("  Duplicate: ${d.relativePath} · ${ScanLogFormatter.formatBytes(d.fileSize)}", style = CrateType.TabularMono)
                                    }
                                }
                                HorizontalDivider(color = CrateColors.BorderHairline)
                            }
                        }
                    }
                }
            }

            StorageToolTab.WATCHED_FOLDERS -> {
                StudioPanel(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Mounted Multi-Folder Watchers", style = CrateType.SectionTitle)
                        if (watchedFolders.isEmpty()) {
                            Text("No watched folders mounted. Click Mount Folder to register your music directories.", fontSize = 12.sp, color = CrateColors.TextMuted)
                        } else {
                            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                items(watchedFolders, key = { it.name }) { folder ->
                                    Row(
                                        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Column {
                                            Text(folder.name, color = CrateColors.TextPrimary, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                                            Text("${folder.fileKeys.size} indexed files · ${if (folder.hasLiveAccess) "Live handle" else "Re-grant access"}", style = CrateType.TabularMono)
                                        }
                                        TextButton(onClick = { onRemoveWatchedFolder(folder.name) }) {
                                            Text("Unwatch", color = CrateColors.CrimsonError, fontSize = 12.sp)
                                        }
                                    }
                                    HorizontalDivider(color = CrateColors.BorderHairline)
                                }
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun StorageTabBtn(label: String, selected: Boolean, onClick: () -> Unit) {
    if (selected) {
        Button(onClick = onClick, colors = ButtonDefaults.buttonColors(containerColor = CrateColors.SurfaceElevated)) {
            Text(label, fontSize = 12.sp, color = CrateColors.Accent)
        }
    } else {
        OutlinedButton(onClick = onClick) {
            Text(label, fontSize = 12.sp, color = CrateColors.TextSecondary)
        }
    }
}
