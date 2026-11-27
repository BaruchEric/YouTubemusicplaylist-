package com.cratesync.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cratesync.core.ScanLogFormatter
import com.cratesync.core.SmartPlaylists
import com.cratesync.core.SyncEngine
import com.cratesync.model.LocalTrack
import com.cratesync.model.Playlist
import com.cratesync.model.SmartPlaylist
import com.cratesync.model.TrackPlayStats
import com.cratesync.ui.theme.CrateColors
import com.cratesync.ui.theme.CrateType
import com.cratesync.ui.theme.StudioPanel
import com.cratesync.youtube.YouTubePush

@Composable
fun PlaylistScreen(
    playlist: Playlist?,
    tracks: List<LocalTrack>,
    onPlayTrack: (LocalTrack, List<LocalTrack>) -> Unit,
    onPushToYouTube: (Playlist) -> Unit,
    onDeletePlaylist: (Playlist) -> Unit,
    onExportM3u8: (Playlist, List<LocalTrack>) -> Unit,
    onInspectTrack: (LocalTrack) -> Unit,
) {
    if (playlist == null) {
        Column(modifier = Modifier.fillMaxSize().padding(24.dp)) {
            Text("Select or create a playlist from the sidebar.", color = CrateColors.TextSecondary)
        }
        return
    }

    val byId = remember(tracks) { tracks.associateBy { it.id } }
    val orderedTracks = remember(playlist, byId) { playlist.trackIds.mapNotNull { byId[it] } }
    val diff = remember(playlist, byId) { SyncEngine.computePlaylistDiff(playlist, byId) }
    val pushEstimate = remember(playlist, orderedTracks) { YouTubePush.estimate(playlist, orderedTracks) }

    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        StudioPanel(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(playlist.name, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = CrateColors.TextPrimary)
                    Text(
                        "${orderedTracks.size} tracks · ${diff.matchedCount} YT matched · +${diff.toAdd.size} / -${diff.toRemove.size} pending · ~${pushEstimate.quotaUnits} quota units",
                        style = CrateType.TabularMono,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { onExportM3u8(playlist, orderedTracks) }) { Text("Export M3U8", fontSize = 12.sp) }
                    Button(
                        enabled = pushEstimate.matchedCount > 0,
                        onClick = { onPushToYouTube(playlist) },
                        colors = ButtonDefaults.buttonColors(containerColor = CrateColors.Accent),
                    ) { Text("Push to YouTube", fontSize = 12.sp) }
                    TextButton(onClick = { onDeletePlaylist(playlist) }) { Text("Delete", color = CrateColors.CrimsonError, fontSize = 12.sp) }
                }
            }
        }

        StudioPanel(modifier = Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(modifier = Modifier.fillMaxSize().padding(12.dp)) {
                itemsIndexed(orderedTracks, key = { _, t -> t.id }) { idx, track ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onPlayTrack(track, orderedTracks) }
                            .padding(vertical = 8.dp, horizontal = 6.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(modifier = Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("${idx + 1}".padStart(2, '0'), style = CrateType.TabularMono)
                            Column {
                                Text(track.title, color = CrateColors.TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                Text("${track.artist} · ${track.album} · ${if (track.youtubeVideoId != null) "YT Ready" else "Unmatched"}", style = CrateType.TabularMono)
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(ScanLogFormatter.formatDurationSeconds(track.duration), style = CrateType.TabularMono)
                            TextButton(onClick = { onInspectTrack(track) }) { Text("Match", fontSize = 11.sp) }
                        }
                    }
                    HorizontalDivider(color = CrateColors.BorderHairline)
                }
            }
        }
    }
}

@Composable
fun SmartPlaylistScreen(
    smartPlaylist: SmartPlaylist?,
    tracks: List<LocalTrack>,
    playStats: Map<String, TrackPlayStats>,
    onPlayTrack: (LocalTrack, List<LocalTrack>) -> Unit,
    onCreateFromPreset: (SmartPlaylist) -> Unit,
    onConvertToPlaylist: (String, List<String>) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (smartPlaylist == null) {
            StudioPanel(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Smart Playlist Presets", style = CrateType.SectionTitle)
                    Text("Live rule-driven playlists that automatically update as your folders change.", fontSize = 12.sp, color = CrateColors.TextSecondary)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SmartPlaylists.PRESETS.forEach { preset ->
                            OutlinedButton(onClick = { onCreateFromPreset(SmartPlaylists.fromPreset(preset)) }) {
                                Text(preset.label, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
            return
        }

        val evaluated = remember(smartPlaylist, tracks, playStats) {
            SmartPlaylists.evaluate(smartPlaylist, tracks, playStats)
        }
        StudioPanel(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(smartPlaylist.name, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = CrateColors.TextPrimary)
                    Text("${evaluated.size} dynamic tracks · Match ${smartPlaylist.matchMode.name} of ${smartPlaylist.rules.size} rules", style = CrateType.TabularMono)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = evaluated.isNotEmpty(),
                        onClick = { onPlayTrack(evaluated.first(), evaluated) },
                        colors = ButtonDefaults.buttonColors(containerColor = CrateColors.Accent),
                    ) { Text("Play All") }
                    OutlinedButton(
                        enabled = evaluated.isNotEmpty(),
                        onClick = { onConvertToPlaylist("${smartPlaylist.name} Snapshot", evaluated.map { it.id }) },
                    ) { Text("Save as Playlist") }
                }
            }
        }

        StudioPanel(modifier = Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(modifier = Modifier.fillMaxSize().padding(12.dp)) {
                itemsIndexed(evaluated, key = { _, t -> t.id }) { idx, track ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onPlayTrack(track, evaluated) }
                            .padding(vertical = 8.dp, horizontal = 6.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("${idx + 1}. ${track.title}", color = CrateColors.TextPrimary, fontSize = 13.sp)
                            Text("${track.artist} · ${track.format} · ${playStats[track.id]?.playCount ?: 0} plays", style = CrateType.TabularMono)
                        }
                        Text(ScanLogFormatter.formatDurationSeconds(track.duration), style = CrateType.TabularMono)
                    }
                    HorizontalDivider(color = CrateColors.BorderHairline)
                }
            }
        }
    }
}
