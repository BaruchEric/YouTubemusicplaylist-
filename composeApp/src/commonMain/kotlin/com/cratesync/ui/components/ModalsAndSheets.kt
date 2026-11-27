package com.cratesync.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.cratesync.core.SmartSearch
import com.cratesync.model.AppToast
import com.cratesync.model.ConfirmationRequest
import com.cratesync.model.LegalLinks
import com.cratesync.model.LocalTrack
import com.cratesync.model.MatchStatus
import com.cratesync.model.Playlist
import com.cratesync.model.ToastLevel
import com.cratesync.model.TrackPlayStats
import com.cratesync.ui.theme.CrateColors
import com.cratesync.ui.theme.CrateType
import com.cratesync.youtube.YouTubeLinks

@Composable
fun ConfirmationModal(
    request: ConfirmationRequest,
    onDismiss: () -> Unit,
    onOpenUrl: (String) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = CrateColors.SurfaceElevated,
        title = { Text(request.title, color = CrateColors.TextPrimary, fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(request.message, color = CrateColors.TextSecondary, fontSize = 13.sp)
                if (request.showYouTubeLegalNotice) {
                    Text(
                        "By pushing playlists to YouTube, you agree to the YouTube Terms of Service and Google Privacy Policy.",
                        fontSize = 11.sp,
                        color = CrateColors.TextMuted,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            "YouTube Terms",
                            fontSize = 11.sp,
                            color = CrateColors.Accent,
                            modifier = Modifier.clickable { onOpenUrl(LegalLinks.YOUTUBE_TERMS_URL) },
                        )
                        Text(
                            "Google Privacy",
                            fontSize = 11.sp,
                            color = CrateColors.Accent,
                            modifier = Modifier.clickable { onOpenUrl(LegalLinks.GOOGLE_PRIVACY_URL) },
                        )
                    }
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", color = CrateColors.TextSecondary) }
        },
        confirmButton = {
            Button(
                onClick = request.onConfirm,
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (request.isDestructive) CrateColors.CrimsonError else CrateColors.Accent
                ),
            ) {
                Text(request.confirmLabel)
            }
        },
    )
}

@Composable
fun SmartSearchDialog(
    tracks: List<LocalTrack>,
    playlists: List<Playlist>,
    playStats: Map<String, TrackPlayStats>,
    onDismiss: () -> Unit,
    onPlayTrack: (LocalTrack, List<LocalTrack>) -> Unit,
    onInspectTrack: (LocalTrack) -> Unit,
    onOpenPlaylist: (Playlist) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val results = remember(query, tracks, playlists) {
        SmartSearch.runGlobal(query, tracks, playlists, playStats)
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
            Text("Smart Search", style = CrateType.SectionTitle)
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Try: is:unmatched lossless plays:>0 -remix", fontSize = 12.sp) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SmartSearch.PRESETS.take(4).forEach { preset ->
                    Text(
                        text = preset.label,
                        fontSize = 11.sp,
                        color = CrateColors.TextSecondary,
                        modifier = Modifier
                            .background(CrateColors.SurfaceElevated, RoundedCornerShape(6.dp))
                            .clickable { query = preset.query }
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }
            HorizontalDivider(color = CrateColors.BorderHairline)
            LazyColumn(modifier = Modifier.heightIn(max = 320.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (results.playlists.isNotEmpty()) {
                    item { Text("PLAYLISTS", fontSize = 10.sp, color = CrateColors.TextMuted) }
                    items(results.playlists.take(4)) { pl ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onOpenPlaylist(pl); onDismiss() }
                                .padding(vertical = 6.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(pl.name, color = CrateColors.TextPrimary, fontSize = 13.sp)
                            Text("${pl.trackIds.size} tracks", style = CrateType.TabularMono)
                        }
                    }
                }
                item { Text("TRACKS (${results.tracks.size})", fontSize = 10.sp, color = CrateColors.TextMuted) }
                items(results.tracks.take(25)) { res ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                onPlayTrack(res.track, results.tracks.map { it.track })
                                onDismiss()
                            }
                            .padding(vertical = 6.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(res.track.title, color = CrateColors.TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                            Text("${res.track.artist} · ${res.genre} · ${res.track.format}", style = CrateType.TabularMono)
                        }
                        TextButton(onClick = { onInspectTrack(res.track); onDismiss() }) {
                            Text("Edit / Match", fontSize = 11.sp)
                        }
                    }
                }
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) { Text("Close") }
            }
        }
    }
}

@Composable
fun TrackMatchEditorDialog(
    track: LocalTrack,
    onDismiss: () -> Unit,
    onSave: (title: String, artist: String, album: String, genre: String?, year: String, ytVideoId: String?, status: MatchStatus) -> Unit,
    onEnrichAi: () -> Unit,
    onOpenYouTubeSearch: () -> Unit,
) {
    var title by remember(track.id) { mutableStateOf(track.title) }
    var artist by remember(track.id) { mutableStateOf(track.artist) }
    var album by remember(track.id) { mutableStateOf(track.album) }
    var genre by remember(track.id) { mutableStateOf(track.genre.orEmpty()) }
    var year by remember(track.id) { mutableStateOf(track.year) }
    var ytInput by remember(track.id) { mutableStateOf(track.youtubeVideoId.orEmpty()) }

    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(CrateColors.Surface, RoundedCornerShape(12.dp))
                .border(1.dp, CrateColors.BorderSubtle, RoundedCornerShape(12.dp))
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Inspect & Match Track", style = CrateType.SectionTitle)
            Text("${track.relativePath} · ${track.format}", style = CrateType.TabularMono)
            OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("Title") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = artist, onValueChange = { artist = it }, label = { Text("Artist") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = album, onValueChange = { album = it }, label = { Text("Album") }, singleLine = true, modifier = Modifier.weight(1.4f))
                OutlinedTextField(value = year, onValueChange = { year = it }, label = { Text("Year") }, singleLine = true, modifier = Modifier.weight(0.6f))
            }
            OutlinedTextField(value = genre, onValueChange = { genre = it }, label = { Text("Genre") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                value = ytInput,
                onValueChange = { ytInput = it },
                label = { Text("YouTube Video URL or 11-char ID") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onOpenYouTubeSearch) { Text("Search YT Music", fontSize = 12.sp) }
                OutlinedButton(onClick = onEnrichAi) { Text("AI Lookup Tags", fontSize = 12.sp) }
            }
            Spacer(Modifier.height(4.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = {
                        val extracted = YouTubeLinks.extractVideoId(ytInput)
                        val status = if (extracted != null) MatchStatus.MATCHED else MatchStatus.UNMATCHED
                        onSave(title, artist, album, genre.ifBlank { null }, year, extracted, status)
                        onDismiss()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = CrateColors.Accent),
                ) {
                    Text("Save Changes")
                }
            }
        }
    }
}

@Composable
fun ToastOverlay(toasts: List<AppToast>, onDismiss: (String) -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalAlignment = Alignment.End,
    ) {
        toasts.forEach { toast ->
            val accent = when (toast.level) {
                ToastLevel.SUCCESS -> CrateColors.Emerald
                ToastLevel.WARNING -> CrateColors.Amber
                ToastLevel.ERROR -> CrateColors.CrimsonError
                ToastLevel.INFO -> CrateColors.TextSecondary
            }
            Box(
                modifier = Modifier
                    .background(CrateColors.SurfaceElevated, RoundedCornerShape(8.dp))
                    .border(1.dp, accent.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                    .clickable { onDismiss(toast.id) }
                    .padding(horizontal = 12.dp, vertical = 9.dp)
            ) {
                Text(toast.message, color = CrateColors.TextPrimary, fontSize = 12.sp)
            }
        }
    }
}
