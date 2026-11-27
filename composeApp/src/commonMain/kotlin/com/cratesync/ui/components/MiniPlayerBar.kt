package com.cratesync.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cratesync.core.ReplayGainEngine
import com.cratesync.core.ScanLogFormatter
import com.cratesync.model.CrossfadeCurve
import com.cratesync.model.PlaybackTransitionSettings
import com.cratesync.model.ReplayGainMode
import com.cratesync.model.ReplayGainSettings
import com.cratesync.state.PlaybackUiState
import com.cratesync.state.RepeatMode
import com.cratesync.ui.theme.CrateColors
import com.cratesync.ui.theme.CrateType

@Composable
fun MiniPlayerBar(
    playback: PlaybackUiState,
    transitionSettings: PlaybackTransitionSettings,
    replayGainSettings: ReplayGainSettings,
    onTogglePlay: () -> Unit,
    onSkipPrev: () -> Unit,
    onSkipNext: () -> Unit,
    onSeek: (Double) -> Unit,
    onVolumeChange: (Float) -> Unit,
    onToggleShuffle: () -> Unit,
    onCycleRepeat: () -> Unit,
    onUpdateTransitions: (PlaybackTransitionSettings) -> Unit,
    onUpdateReplayGain: (ReplayGainSettings) -> Unit,
) {
    val track = playback.currentTrack ?: return
    var showAudioSettings by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(CrateColors.NavChrome)
            .border(1.dp, CrateColors.BorderHairline)
            .padding(horizontal = 16.dp, vertical = 8.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(modifier = Modifier.weight(1.2f)) {
                Text(
                    text = track.title,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = CrateColors.TextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val rgSummary = playback.appliedReplayGain?.let {
                    " · RG ${ReplayGainEngine.formatGainDb(it.appliedGainDb)}"
                }.orEmpty()
                val transSummary = playback.upcomingTransition?.let { " · ${it.label}" }.orEmpty()
                Text(
                    text = "${track.artist} · ${playback.audioSourceLabel}$rgSummary$transSummary",
                    style = CrateType.TabularMono,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onToggleShuffle, modifier = Modifier.size(44.dp)) {
                    Icon(
                        Icons.Default.Shuffle,
                        contentDescription = "Smart Shuffle",
                        tint = if (playback.isShuffled) CrateColors.Accent else CrateColors.TextSecondary,
                    )
                }
                IconButton(onClick = onSkipPrev, modifier = Modifier.size(44.dp)) {
                    Icon(Icons.Default.SkipPrevious, contentDescription = "Previous", tint = CrateColors.TextPrimary)
                }
                IconButton(onClick = onTogglePlay, modifier = Modifier.size(48.dp)) {
                    Icon(
                        if (playback.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (playback.isPlaying) "Pause" else "Play",
                        tint = CrateColors.Accent,
                        modifier = Modifier.size(28.dp),
                    )
                }
                IconButton(onClick = onSkipNext, modifier = Modifier.size(44.dp)) {
                    Icon(Icons.Default.SkipNext, contentDescription = "Next", tint = CrateColors.TextPrimary)
                }
                IconButton(onClick = onCycleRepeat, modifier = Modifier.size(44.dp)) {
                    Icon(
                        if (playback.repeatMode == RepeatMode.ONE) Icons.Default.RepeatOne else Icons.Default.Repeat,
                        contentDescription = "Repeat",
                        tint = if (playback.repeatMode != RepeatMode.OFF) CrateColors.Accent else CrateColors.TextSecondary,
                    )
                }
                IconButton(onClick = { showAudioSettings = !showAudioSettings }, modifier = Modifier.size(44.dp)) {
                    Icon(
                        Icons.Default.Tune,
                        contentDescription = "Crossfade & ReplayGain",
                        tint = if (showAudioSettings) CrateColors.Accent else CrateColors.TextSecondary,
                    )
                }
            }

            Row(
                modifier = Modifier.width(150.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.VolumeUp, contentDescription = null, tint = CrateColors.TextSecondary, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Slider(
                    value = playback.volume,
                    onValueChange = onVolumeChange,
                    colors = SliderDefaults.colors(thumbColor = CrateColors.Accent, activeTrackColor = CrateColors.Accent),
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(ScanLogFormatter.formatDurationSeconds(playback.positionSec), style = CrateType.TabularMono)
            Slider(
                value = if (playback.durationSec > 0.0) (playback.positionSec / playback.durationSec).toFloat().coerceIn(0f, 1f) else 0f,
                onValueChange = { frac -> if (playback.durationSec > 0.0) onSeek(frac * playback.durationSec) },
                modifier = Modifier.weight(1f).height(20.dp),
                colors = SliderDefaults.colors(thumbColor = CrateColors.Accent, activeTrackColor = CrateColors.Accent),
            )
            Text(ScanLogFormatter.formatDurationSeconds(playback.durationSec), style = CrateType.TabularMono)
        }

        if (showAudioSettings) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp)
                    .background(CrateColors.SurfaceElevated, RoundedCornerShape(8.dp))
                    .border(1.dp, CrateColors.BorderHairline, RoundedCornerShape(8.dp))
                    .padding(10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.GraphicEq, contentDescription = null, tint = CrateColors.Accent, modifier = Modifier.size(16.dp))
                    Text("Crossfade ${transitionSettings.crossfadeSeconds}s (${transitionSettings.crossfadeCurve.name})", style = CrateType.TabularMono, color = CrateColors.TextPrimary)
                    Slider(
                        value = transitionSettings.crossfadeSeconds.toFloat(),
                        onValueChange = {
                            val snapped = (it * 2).toInt() / 2.0
                            onUpdateTransitions(transitionSettings.copy(crossfadeSeconds = snapped))
                        },
                        valueRange = 0f..12f,
                        modifier = Modifier.width(120.dp),
                    )
                    androidx.compose.material3.TextButton(onClick = {
                        val nextCurve = when (transitionSettings.crossfadeCurve) {
                            CrossfadeCurve.EQUAL_POWER -> CrossfadeCurve.SMOOTH_S
                            CrossfadeCurve.SMOOTH_S -> CrossfadeCurve.LINEAR
                            CrossfadeCurve.LINEAR -> CrossfadeCurve.EQUAL_POWER
                        }
                        onUpdateTransitions(transitionSettings.copy(crossfadeCurve = nextCurve))
                    }) { Text("Cycle Curve", fontSize = 11.sp) }
                }

                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "ReplayGain: ${replayGainSettings.mode.name} · ${replayGainSettings.targetLufs} LUFS",
                        style = CrateType.TabularMono,
                        color = CrateColors.TextPrimary,
                    )
                    androidx.compose.material3.TextButton(onClick = {
                        val nextMode = when (replayGainSettings.mode) {
                            ReplayGainMode.OFF -> ReplayGainMode.TRACK
                            ReplayGainMode.TRACK -> ReplayGainMode.ALBUM
                            ReplayGainMode.ALBUM -> ReplayGainMode.OFF
                        }
                        onUpdateReplayGain(replayGainSettings.copy(mode = nextMode))
                    }) { Text("Mode", fontSize = 11.sp) }
                    androidx.compose.material3.TextButton(onClick = {
                        val nextLufs = when (replayGainSettings.targetLufs) {
                            -14 -> -16
                            -16 -> -18
                            else -> -14
                        }
                        onUpdateReplayGain(replayGainSettings.copy(targetLufs = nextLufs))
                    }) { Text("LUFS", fontSize = 11.sp) }
                }
            }
        }
    }
}
