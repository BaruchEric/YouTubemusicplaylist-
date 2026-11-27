package com.cratesync.core

import com.cratesync.model.CrossfadeCurve
import com.cratesync.model.LocalTrack
import com.cratesync.model.PlaybackTransitionSettings
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.round
import kotlin.math.sin

data class CrossfadeGainPair(val outgoing: Double, val incoming: Double)

enum class UpcomingTransitionMode { GAPLESS_ALBUM, GAPLESS, CROSSFADE, DIRECT }

data class UpcomingTransitionDescription(
    val mode: UpcomingTransitionMode,
    val label: String,
)

object AudioTransitions {
    val CROSSFADE_PRESETS = listOf(0.0, 2.0, 4.0, 6.0, 8.0, 12.0)

    fun clampCrossfadeSeconds(seconds: Double): Double {
        if (!seconds.isFinite()) return 4.0
        val clamped = seconds.coerceIn(0.0, 12.0)
        return round(clamped * 2.0) / 2.0
    }

    fun evaluateCurve(progress: Double, curve: CrossfadeCurve): CrossfadeGainPair {
        val t = progress.coerceIn(0.0, 1.0)
        return when (curve) {
            CrossfadeCurve.LINEAR -> CrossfadeGainPair(1.0 - t, t)
            CrossfadeCurve.SMOOTH_S -> {
                val s = t * t * (3.0 - 2.0 * t)
                CrossfadeGainPair(1.0 - s, s)
            }
            CrossfadeCurve.EQUAL_POWER -> CrossfadeGainPair(
                outgoing = cos(t * PI * 0.5),
                incoming = sin(t * PI * 0.5),
            )
        }
    }

    fun isConsecutiveSameAlbumPair(
        currentTrack: LocalTrack?,
        nextTrack: LocalTrack?,
        isShuffled: Boolean,
    ): Boolean {
        if (isShuffled || currentTrack == null || nextTrack == null || currentTrack.id == nextTrack.id) return false
        val albumA = currentTrack.album.trim().lowercase()
        val albumB = nextTrack.album.trim().lowercase()
        if (albumA.isEmpty() || albumB.isEmpty() || albumA == "unknown album" || albumB == "unknown album") return false
        if (albumA != albumB) return false
        val numA = currentTrack.trackNumber
        val numB = nextTrack.trackNumber
        if (numA != null && numB != null && numA > 0 && numB > 0) {
            return numB == numA + 1
        }
        return true
    }

    fun describeUpcoming(
        currentTrack: LocalTrack?,
        nextTrack: LocalTrack?,
        isShuffled: Boolean,
        settings: PlaybackTransitionSettings,
    ): UpcomingTransitionDescription {
        val albumContinuous = settings.gaplessPlayback &&
            settings.gaplessAlbumContinuity &&
            isConsecutiveSameAlbumPair(currentTrack, nextTrack, isShuffled)
        if (albumContinuous) {
            return UpcomingTransitionDescription(UpcomingTransitionMode.GAPLESS_ALBUM, "Gapless (same album)")
        }
        if (settings.crossfadeSeconds > 0.0) {
            val curveLabel = when (settings.crossfadeCurve) {
                CrossfadeCurve.EQUAL_POWER -> "Equal Power"
                CrossfadeCurve.SMOOTH_S -> "Smooth S"
                CrossfadeCurve.LINEAR -> "Linear"
            }
            val secLabel = if (settings.crossfadeSeconds % 1.0 == 0.0) {
                "${settings.crossfadeSeconds.toInt()}s"
            } else {
                "${settings.crossfadeSeconds}s"
            }
            return UpcomingTransitionDescription(UpcomingTransitionMode.CROSSFADE, "$secLabel $curveLabel")
        }
        if (settings.gaplessPlayback) {
            return UpcomingTransitionDescription(UpcomingTransitionMode.GAPLESS, "Gapless handoff")
        }
        return UpcomingTransitionDescription(UpcomingTransitionMode.DIRECT, "Standard cut")
    }
}
