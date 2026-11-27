package com.cratesync.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.window.Dialog
import com.cratesync.core.SyncEngine
import com.cratesync.drive.DriveFolderCountStats
import com.cratesync.drive.DriveFolderItem
import com.cratesync.drive.DriveFolderScope
import com.cratesync.model.FolderSyncDirection
import com.cratesync.model.LocalTrack
import com.cratesync.ui.theme.CrateColors
import com.cratesync.ui.theme.CrateType
import com.cratesync.youtube.MatchConfidence
import com.cratesync.youtube.MatchProposal
import com.cratesync.youtube.YouTubeBulkMatch

/**
 * Bulk Match YouTube Dialog supporting pasted/imported M3U8/CSV/TXT lists, YouTube playlist IDs,
 * and deterministic candidate review before writing video IDs into the catalog.
 */
@Composable
fun BulkMatchDialog(
    tracks: List<LocalTrack>,
    onDismiss: () -> Unit,
    onApplyProposals: (List<MatchProposal>, fromYouTubeApi: Boolean) -> Unit,
) {
    var pastedText by remember { mutableStateOf("") }
    var proposals by remember { mutableStateOf<List<MatchProposal>>(emptyList()) }
    var selectedIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    val unmatched = remember(tracks) { YouTubeBulkMatch.songsToMatch(tracks) }
    val trackById = remember(tracks) { tracks.associateBy { it.id } }

    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(CrateColors.Surface, RoundedCornerShape(12.dp))
                .border(1.dp, CrateColors.BorderSubtle, RoundedCornerShape(12.dp))
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Bulk Match YouTube (${unmatched.size} unmatched)", style = CrateType.SectionTitle)
            Text(
                "Paste a list of songs with YouTube/YT Music links or M3U8 lines. Deterministic scoring guards against live/remix/karaoke mismatches.",
                fontSize = 12.sp,
                color = CrateColors.TextSecondary,
            )
            OutlinedTextField(
                value = pastedText,
                onValueChange = { pastedText = it },
                placeholder = { Text("Artist - Title https://music.youtube.com/watch?v=...", fontSize = 12.sp) },
                modifier = Modifier.fillMaxWidth().height(96.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        val seeds = SyncEngine.parseImportedText(pastedText)
                        val candidates = YouTubeBulkMatch.candidatesFromSeeds(seeds)
                        val found = YouTubeBulkMatch.planBulkMatch(unmatched, candidates)
                        proposals = found
                        selectedIds = found.map { it.trackId }.toSet()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = CrateColors.Accent),
                ) {
                    Text("Score Candidates")
                }
                Text("Quota: 0 units (local matching)", style = CrateType.TabularMono, modifier = Modifier.align(Alignment.CenterVertically))
            }

            if (proposals.isNotEmpty()) {
                HorizontalDivider(color = CrateColors.BorderHairline)
                LazyColumn(modifier = Modifier.heightIn(max = 220.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(proposals) { p ->
                        val local = trackById[p.trackId]
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(
                                checked = p.trackId in selectedIds,
                                onCheckedChange = { checked ->
                                    selectedIds = if (checked) selectedIds + p.trackId else selectedIds - p.trackId
                                },
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(local?.title ?: p.trackId, color = CrateColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                                Text(
                                    "→ ${p.candidate.title} · ${if (p.confidence == MatchConfidence.EXACT) "Exact" else "Likely"}",
                                    style = CrateType.TabularMono,
                                    color = if (p.confidence == MatchConfidence.EXACT) CrateColors.Emerald else CrateColors.Amber,
                                )
                            }
                        }
                    }
                }
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Spacer(Modifier.width(8.dp))
                Button(
                    enabled = selectedIds.isNotEmpty(),
                    onClick = {
                        onApplyProposals(proposals.filter { it.trackId in selectedIds }, false)
                        onDismiss()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = CrateColors.Accent),
                ) {
                    Text("Apply ${selectedIds.size} Matches")
                }
            }
        }
    }
}

/**
 * Google Drive Folder Browser powered by the fair 3-phase DFS audio/subfolder counter
 * with `Hide 0 audio` filtering and per-device local folder binding.
 */
@Composable
fun DriveFolderBrowserDialog(
    scope: DriveFolderScope,
    folders: List<DriveFolderItem>,
    stats: Map<String, DriveFolderCountStats>,
    hideZeroAudio: Boolean,
    isIndexing: Boolean,
    onSwitchScope: (DriveFolderScope) -> Unit,
    onToggleHideZero: () -> Unit,
    onBindFolder: (DriveFolderItem, localPath: String, FolderSyncDirection, autoCache: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var localPathInput by remember { mutableStateOf("Music") }
    var selectedFolder by remember { mutableStateOf<DriveFolderItem?>(null) }

    val visibleFolders = remember(folders, stats, hideZeroAudio) {
        if (!hideZeroAudio) folders
        else folders.filter { f ->
            val st = stats[f.id]
            st == null || st.audioCount > 0 || st.isPartial
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(CrateColors.Surface, RoundedCornerShape(12.dp))
                .border(1.dp, CrateColors.BorderSubtle, RoundedCornerShape(12.dp))
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Select Google Drive Music Folder", style = CrateType.SectionTitle)
                if (isIndexing) Text("Indexing Drive…", style = CrateType.TabularMono, color = CrateColors.Amber)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { onSwitchScope(DriveFolderScope.MY_DRIVE) }) {
                    Text("My Drive", color = if (scope == DriveFolderScope.MY_DRIVE) CrateColors.Accent else CrateColors.TextSecondary)
                }
                OutlinedButton(onClick = { onSwitchScope(DriveFolderScope.SHARED_WITH_ME) }) {
                    Text("Shared with me", color = if (scope == DriveFolderScope.SHARED_WITH_ME) CrateColors.Accent else CrateColors.TextSecondary)
                }
                OutlinedButton(onClick = onToggleHideZero) {
                    Text(if (hideZeroAudio) "Showing Audio Folders" else "Hide 0 audio")
                }
            }
            HorizontalDivider(color = CrateColors.BorderHairline)
            LazyColumn(modifier = Modifier.heightIn(max = 260.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(visibleFolders) { folder ->
                    val st = stats[folder.id]
                    val suffix = if (st?.isPartial == true) "+" else ""
                    val isSelected = selectedFolder?.id == folder.id
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(if (isSelected) CrateColors.SurfaceElevated else CrateColors.Surface, RoundedCornerShape(6.dp))
                            .clickable { selectedFolder = folder }
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(folder.name, color = CrateColors.TextPrimary, fontSize = 13.sp, fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal)
                        Text(
                            text = if (st != null) "${st.subfolderCount}$suffix folders · ${st.audioCount}$suffix audio" else "Counting…",
                            style = CrateType.TabularMono,
                        )
                    }
                }
            }
            OutlinedTextField(
                value = localPathInput,
                onValueChange = { localPathInput = it },
                label = { Text("Bind to local folder path on this device") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Spacer(Modifier.width(8.dp))
                Button(
                    enabled = selectedFolder != null,
                    onClick = {
                        selectedFolder?.let { onBindFolder(it, localPathInput, FolderSyncDirection.BIDIRECTIONAL, true) }
                        onDismiss()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = CrateColors.Accent),
                ) {
                    Text("Bind Folder")
                }
            }
        }
    }
}
