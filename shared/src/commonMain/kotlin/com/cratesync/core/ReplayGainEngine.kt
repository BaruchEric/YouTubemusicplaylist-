package com.cratesync.core

import com.cratesync.model.ReplayGainMode
import com.cratesync.model.ReplayGainSettings
import com.cratesync.model.TrackLoudnessData
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.round
import kotlin.math.sin
import kotlin.math.sqrt

data class AppliedReplayGainInfo(
    val measuredLufs: Double,
    val peak: Double,
    val rawGainDb: Double,
    val appliedGainDb: Double,
    val linearGain: Double,
    val clippingPrevented: Boolean,
    val scope: String,
    val albumTrackCount: Int,
)

/**
 * Pure-Kotlin ITU-R BS.1770 K-weighting DSP, gated integrated LUFS analyzer,
 * EBU R128 album loudness aggregator, and ReplayGain peak-clipping limiter.
 */
object ReplayGainEngine {
    const val MAX_CACHE_ENTRIES = 600
    val TARGET_LUFS_OPTIONS = listOf(-14, -16, -18)

    fun dbToLinear(db: Double): Double = if (db.isFinite()) 10.0.pow(db / 20.0) else 1.0

    fun linearToDb(linear: Double): Double =
        if (!linear.isFinite() || linear <= 1e-6) -120.0 else 20.0 * log10(linear)

    fun formatGainDb(db: Double): String {
        if (!db.isFinite() || abs(db) < 0.05) return "0.0 dB"
        val rounded = round(db * 10.0) / 10.0
        val sign = if (rounded > 0) "+" else ""
        return "$sign$rounded dB"
    }

    fun formatLufs(lufs: Double): String =
        if (!lufs.isFinite()) "— LUFS" else "${round(lufs * 10.0) / 10.0} LUFS"

    private class Biquad(
        private val b0: Double,
        private val b1: Double,
        private val b2: Double,
        private val a1: Double,
        private val a2: Double,
    ) {
        private var z1 = 0.0
        private var z2 = 0.0

        fun process(x: Double): Double {
            val y = b0 * x + z1
            z1 = b1 * x - a1 * y + z2
            z2 = b2 * x - a2 * y
            return y
        }
    }

    private fun highShelfBiquad(sampleRate: Int, freq: Double = 1500.0, gainDb: Double = 4.0, q: Double = 0.7071): Biquad {
        val a = 10.0.pow(gainDb / 40.0)
        val w0 = 2.0 * PI * freq / sampleRate
        val cosW0 = cos(w0)
        val alpha = sin(w0) / (2.0 * q)
        val twoSqrtAAlpha = 2.0 * sqrt(a) * alpha
        val a0 = (a + 1.0) - (a - 1.0) * cosW0 + twoSqrtAAlpha
        val b0 = a * ((a + 1.0) + (a - 1.0) * cosW0 + twoSqrtAAlpha) / a0
        val b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cosW0) / a0
        val b2 = a * ((a + 1.0) + (a - 1.0) * cosW0 - twoSqrtAAlpha) / a0
        val a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cosW0) / a0
        val a2 = ((a + 1.0) - (a - 1.0) * cosW0 - twoSqrtAAlpha) / a0
        return Biquad(b0, b1, b2, a1, a2)
    }

    private fun highPassBiquad(sampleRate: Int, freq: Double = 38.0, q: Double = 0.5): Biquad {
        val w0 = 2.0 * PI * freq / sampleRate
        val cosW0 = cos(w0)
        val alpha = sin(w0) / (2.0 * q)
        val a0 = 1.0 + alpha
        val b0 = ((1.0 + cosW0) / 2.0) / a0
        val b1 = -(1.0 + cosW0) / a0
        val b2 = ((1.0 + cosW0) / 2.0) / a0
        val a1 = (-2.0 * cosW0) / a0
        val a2 = (1.0 - alpha) / a0
        return Biquad(b0, b1, b2, a1, a2)
    }

    /**
     * Measures ITU-R BS.1770 K-weighted integrated LUFS and sample peak from decoded planar PCM floats.
     */
    fun analyzePcmLoudness(
        channels: List<FloatArray>,
        sampleRate: Int,
        analyzedAt: Long,
        album: String? = null,
    ): TrackLoudnessData {
        if (channels.isEmpty() || channels.first().isEmpty() || sampleRate <= 0) {
            return TrackLoudnessData(-23.0, 0.001, analyzedAt, album?.trim()?.ifEmpty { null })
        }

        var peak = 0.0
        val filtered = channels.take(6).map { ch ->
            val pre = highShelfBiquad(sampleRate)
            val rlb = highPassBiquad(sampleRate)
            DoubleArray(ch.size) { i ->
                val s = ch[i].toDouble()
                val absS = abs(s)
                if (absS > peak) peak = absS
                rlb.process(pre.process(s))
            }
        }

        val totalSamples = filtered.first().size
        val blockSize = max(1, round(sampleRate * 0.4).toInt())
        val hopSize = max(1, round(sampleRate * 0.1).toInt())
        val weights = DoubleArray(filtered.size) { ch ->
            when {
                filtered.size >= 6 && ch == 3 -> 0.0
                ch >= 3 -> 1.41
                else -> 1.0
            }
        }

        val blockEnergies = mutableListOf<Double>()
        val blockLufs = mutableListOf<Double>()

        fun addBlock(start: Int, end: Int) {
            val len = max(1, end - start)
            var energy = 0.0
            for (ch in filtered.indices) {
                val w = weights[ch]
                if (w == 0.0) continue
                val arr = filtered[ch]
                var sq = 0.0
                for (i in start until end) sq += arr[i] * arr[i]
                energy += w * (sq / len)
            }
            if (energy > 1e-10) {
                val lufs = -0.691 + 10.0 * log10(energy)
                if (lufs > -70.0) {
                    blockEnergies += energy
                    blockLufs += lufs
                }
            }
        }

        if (totalSamples < blockSize) {
            addBlock(0, totalSamples)
        } else {
            var start = 0
            while (start + blockSize <= totalSamples) {
                addBlock(start, start + blockSize)
                start += hopSize
            }
        }

        var integrated = -23.0
        if (blockEnergies.isNotEmpty()) {
            val absMean = blockEnergies.average()
            val relThreshold = -0.691 + 10.0 * log10(absMean) - 10.0
            var relSum = 0.0
            var relCount = 0
            for (i in blockEnergies.indices) {
                if (blockLufs[i] > relThreshold) {
                    relSum += blockEnergies[i]
                    relCount++
                }
            }
            val finalEnergy = if (relCount > 0) relSum / relCount else absMean
            integrated = -0.691 + 10.0 * log10(max(1e-10, finalEnergy))
        }

        return TrackLoudnessData(
            integratedLufs = (round(integrated * 10.0) / 10.0).coerceIn(-50.0, -1.0),
            peak = (round(peak * 1000.0) / 1000.0).coerceIn(0.001, 4.0),
            analyzedAt = analyzedAt,
            album = album?.trim()?.ifEmpty { null },
        )
    }

    private fun normalizeAlbumKey(album: String?): String {
        val trimmed = album?.trim()?.lowercase().orEmpty()
        if (trimmed.isEmpty() || trimmed in setOf("unknown album", "unknown", "singles")) return ""
        return trimmed
    }

    fun computeAdjustment(
        trackKey: String,
        trackAlbum: String?,
        cache: Map<String, TrackLoudnessData>,
        settings: ReplayGainSettings,
        libraryAlbumLookup: Map<String, String> = emptyMap(),
    ): AppliedReplayGainInfo? {
        if (settings.mode == ReplayGainMode.OFF) return null
        val entry = cache[trackKey] ?: return null

        var measuredLufs = entry.integratedLufs
        var peak = entry.peak
        var scope = "track"
        var albumTrackCount = 1

        if (settings.mode == ReplayGainMode.ALBUM) {
            val albumKey = normalizeAlbumKey(trackAlbum ?: entry.album)
            if (albumKey.isNotEmpty()) {
                val matches = cache.entries.filter { (k, v) ->
                    normalizeAlbumKey(libraryAlbumLookup[k] ?: v.album) == albumKey
                }.map { it.value }
                if (matches.size >= 2) {
                    val avgPower = matches.map { 10.0.pow((it.integratedLufs + 0.691) / 10.0) }.average()
                    measuredLufs = (round((-0.691 + 10.0 * log10(max(1e-10, avgPower))) * 10.0) / 10.0).coerceIn(-50.0, -1.0)
                    peak = matches.maxOf { it.peak }
                    scope = "album"
                    albumTrackCount = matches.size
                }
            }
        }

        val rawGainDb = (settings.targetLufs - measuredLufs + settings.preampDb).coerceIn(-18.0, 12.0)
        var linearGain = dbToLinear(rawGainDb)
        var clippingPrevented = false

        if (settings.preventClipping && peak > 0.001) {
            val maxSafe = 0.98 / peak
            if (linearGain > maxSafe) {
                linearGain = maxSafe
                clippingPrevented = true
            }
        }
        linearGain = linearGain.coerceIn(0.06, 4.0)
        val appliedGainDb = round(linearToDb(linearGain) * 10.0) / 10.0

        return AppliedReplayGainInfo(
            measuredLufs = measuredLufs,
            peak = peak,
            rawGainDb = round(rawGainDb * 10.0) / 10.0,
            appliedGainDb = appliedGainDb,
            linearGain = linearGain,
            clippingPrevented = clippingPrevented,
            scope = scope,
            albumTrackCount = albumTrackCount,
        )
    }
}
