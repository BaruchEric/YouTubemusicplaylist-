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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import com.cratesync.core.AnalyticsEngine
import com.cratesync.core.ScanLogFormatter
import com.cratesync.core.SmartPlaylists
import com.cratesync.core.SmartSearch
import com.cratesync.model.LocalTrack
import com.cratesync.model.PlayHistoryEntry
import com.cratesync.model.SavedDashboardFilter
import com.cratesync.model.SmartPlaylist
import com.cratesync.model.TrackPlayStats
import com.cratesync.platform.currentTimeMillis
import com.cratesync.platform.randomUuid
import com.cratesync.ui.components.DailyListeningChartCard
import com.cratesync.ui.components.GenreDistributionChartCard
import com.cratesync.ui.components.ListeningHeatmapCard
import com.cratesync.ui.components.WeeklyHabitsChartCard
import com.cratesync.ui.components.WeeklyTracksAddedChartCard
import com.cratesync.ui.theme.CrateColors
import com.cratesync.ui.theme.CrateType
import com.cratesync.ui.theme.StudioPanel

@Composable
fun DashboardScreen(
    tracks: List<LocalTrack>,
    playStats: Map<String, TrackPlayStats>,
    playHistory: List<PlayHistoryEntry>,
    savedFilters: List<SavedDashboardFilter>,
    onScanFolder: () -> Unit,
    onOpenBulkMatch: () -> Unit,
    onPlayTrack: (LocalTrack, List<LocalTrack>) -> Unit,
    onSaveDashboardFilter: (SavedDashboardFilter) -> Unit,
    onDeleteDashboardFilter: (String) -> Unit,
    onCreateSmartPlaylistFromPreset: (SmartPlaylist) -> Unit,
    onClassifyGenresAi: () -> Unit,
) {
    var activeFilterQuery by remember { mutableStateOf("") }
    val filteredTracks = remember(tracks, activeFilterQuery, playStats) {
        if (activeFilterQuery.isBlank()) tracks
        else SmartSearch.evaluateTracks(tracks, activeFilterQuery, playStats).second.map { it.track }
    }
    val now = remember(tracks.size, playHistory.size) { currentTimeMillis() }
    val stats = remember(filteredTracks, playStats) { AnalyticsEngine.computeTrackStats(filteredTracks, playStats) }
    val localGenres = remember(filteredTracks) { AnalyticsEngine.computeGenreDistribution(filteredTracks) }
    val globalGenres = remember(tracks) { AnalyticsEngine.computeGenreDistribution(tracks, maxSlices = 10) }
    val dailyListening = remember(playHistory, now) { AnalyticsEngine.computeDailyListening(playHistory, now) }
    val weeklyHabits = remember(playHistory) { AnalyticsEngine.computeWeeklyHabits(playHistory) }
    val weeklyAdded = remember(filteredTracks, now) { AnalyticsEngine.computeWeeklyTracksAdded(filteredTracks, now) }
    val heatmap = remember(playHistory, now) { AnalyticsEngine.computeActivityHeatmap(playHistory, now) }
    val albums = remember(filteredTracks) { AnalyticsEngine.computeAlbumGallery(filteredTracks) }
    val recommendations = remember(tracks, playStats) { AnalyticsEngine.recommendForYou(tracks, playStats) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (tracks.isEmpty()) {
            StudioPanel(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Mount your first local music crate", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = CrateColors.TextPrimary)
                    Text(
                        "CrateSync reads embedded ID3, FLAC, MP4, and WAV tags directly from your folders without copying gigabytes of audio, matches songs to YouTube Music, and syncs across devices via Google Drive.",
                        fontSize = 13.sp,
                        color = CrateColors.TextSecondary,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(onClick = onScanFolder, colors = ButtonDefaults.buttonColors(containerColor = CrateColors.Accent)) {
                            Text("Scan Local Folder")
                        }
                        OutlinedButton(onClick = { onCreateSmartPlaylistFromPreset(SmartPlaylists.fromPreset(SmartPlaylists.PRESETS.first())) }) {
                            Text("Create Starter Smart Playlist")
                        }
                    }
                }
            }
        }

        // KPI Summary Strip (tabular numerals, flat single-elevation)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            KpiCard("CATALOG TRACKS", "${stats.totalTracks}", "${stats.losslessCount} lossless · ${ScanLogFormatter.formatBytes(stats.totalBytes)}", Modifier.weight(1f))
            KpiCard("YOUTUBE MATCHED", "${stats.matchedTracks}", "${stats.totalTracks - stats.matchedTracks} unmatched", Modifier.weight(1f))
            KpiCard("LISTENING TIME", ScanLogFormatter.formatDurationSeconds(stats.totalDurationSec), "${stats.totalPlays} recorded plays", Modifier.weight(1f))
            KpiCard("DEVICE HEALTH", "${stats.totalTracks - stats.missingTracks}", "${stats.missingTracks} missing files", Modifier.weight(1f))
        }

        // Dashboard Smart Filter Bar + Quick Actions
        StudioPanel(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = activeFilterQuery,
                        onValueChange = { activeFilterQuery = it },
                        placeholder = { Text("Filter dashboard analytics (e.g. lossless plays:>0 genre:electronic)", fontSize = 12.sp) },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedButton(
                        enabled = activeFilterQuery.isNotBlank(),
                        onClick = {
                            onSaveDashboardFilter(
                                SavedDashboardFilter(randomUuid(), activeFilterQuery.take(24), activeFilterQuery, currentTimeMillis())
                            )
                        },
                    ) { Text("Save Filter", fontSize = 12.sp) }
                    OutlinedButton(onClick = onOpenBulkMatch) { Text("Bulk Match YT", fontSize = 12.sp) }
                    OutlinedButton(onClick = onClassifyGenresAi) { Text("AI Genres", fontSize = 12.sp) }
                }
                if (savedFilters.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        savedFilters.forEach { sf ->
                            OutlinedButton(onClick = { activeFilterQuery = sf.query }) {
                                Text(sf.name, fontSize = 11.sp)
                            }
                            Text(
                                "×",
                                color = CrateColors.TextMuted,
                                modifier = Modifier.clickable { onDeleteDashboardFilter(sf.id) }.padding(top = 10.dp),
                            )
                        }
                    }
                }
            }
        }

        // Analytics Row 1: Filtered Genre Distribution + Global Genre Distribution
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            GenreDistributionChartCard("Genre Distribution", "Active dashboard scope (${filteredTracks.size} tracks)", localGenres, Modifier.weight(1f))
            GenreDistributionChartCard("Global Library Genres", "Full cross-device catalog (${tracks.size} tracks)", globalGenres, Modifier.weight(1f))
        }

        // Analytics Row 2: Daily Listening + Weekly Habits
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            DailyListeningChartCard(dailyListening, Modifier.weight(1f))
            WeeklyHabitsChartCard(weeklyHabits, Modifier.weight(1f))
        }

        // Analytics Row 3: Weekly Tracks Added + Listening Activity Heatmap
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            WeeklyTracksAddedChartCard(weeklyAdded, Modifier.weight(1f))
            ListeningHeatmapCard(heatmap, Modifier.weight(1f))
        }

        // Album Art Gallery & Recommendations
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StudioPanel(modifier = Modifier.weight(1f)) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Album Art Gallery (${albums.size})", style = CrateType.SectionTitle)
                    if (albums.isEmpty()) {
                        Text("Albums appear here once audio tags are scanned.", fontSize = 12.sp, color = CrateColors.TextMuted)
                    } else {
                        albums.take(6).forEach { alb ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        val first = tracks.firstOrNull { it.id in alb.trackIds }
                                        if (first != null) onPlayTrack(first, tracks.filter { it.id in alb.trackIds })
                                    }
                                    .padding(vertical = 4.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(alb.album, color = CrateColors.TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                    Text("${alb.artist} · ${alb.year.ifBlank { "—" }}", style = CrateType.TabularMono)
                                }
                                Text("${alb.trackIds.size} tracks", style = CrateType.TabularMono)
                            }
                        }
                    }
                }
            }

            StudioPanel(modifier = Modifier.weight(1f)) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Recommended For You", style = CrateType.SectionTitle)
                    if (recommendations.isEmpty()) {
                        Text("Play a few tracks to build genre affinity recommendations.", fontSize = 12.sp, color = CrateColors.TextMuted)
                    } else {
                        recommendations.take(6).forEach { rec ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { onPlayTrack(rec, recommendations) }
                                    .padding(vertical = 4.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(rec.title, color = CrateColors.TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                    Text("${rec.artist} · ${rec.format}", style = CrateType.TabularMono)
                                }
                                Text(ScanLogFormatter.formatDurationSeconds(rec.duration), style = CrateType.TabularMono)
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
    }
}

@Composable
private fun KpiCard(label: String, value: String, detail: String, modifier: Modifier = Modifier) {
    StudioPanel(modifier = modifier) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = CrateColors.TextMuted)
            Text(value, style = CrateType.TabularMetric)
            Text(detail, style = CrateType.TabularMono)
        }
    }
}
