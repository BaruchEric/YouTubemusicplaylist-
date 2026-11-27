package com.cratesync.core

import com.cratesync.model.LocalTrack
import com.cratesync.model.PlayHistoryEntry
import com.cratesync.model.TrackPlayStats
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

data class GenreSlice(val genre: String, val count: Int, val share: Float)
data class DailyListeningPoint(val label: String, val dayKey: String, val plays: Int, val minutes: Int)
data class WeeklyHabitPoint(val dayLabel: String, val plays: Int, val minutes: Int)
data class WeeklyAddedPoint(val weekLabel: String, val count: Int)
data class HeatmapCell(val dayKey: String, val plays: Int, val intensity: Int)
data class AlbumGalleryItem(
    val album: String,
    val artist: String,
    val year: String,
    val coverArtUrl: String?,
    val trackIds: List<String>,
)
data class TrackStatsSummary(
    val totalTracks: Int,
    val matchedTracks: Int,
    val missingTracks: Int,
    val losslessCount: Int,
    val totalBytes: Long,
    val totalDurationSec: Double,
    val totalPlays: Int,
    val topTracks: List<Pair<LocalTrack, Int>>,
)

/**
 * Pure-Kotlin aggregators powering all 6 Dashboard charts, Album Art Gallery,
 * Track Statistics, and Genre-based Recommendations.
 */
object AnalyticsEngine {
    private val LOSSLESS = setOf("FLAC", "WAV", "AIFF", "AIF", "AIFC", "ALAC")

    fun computeGenreDistribution(tracks: List<LocalTrack>, maxSlices: Int = 8): List<GenreSlice> {
        if (tracks.isEmpty()) return emptyList()
        val counts = tracks.groupingBy { inferTrackGenre(it).genre }.eachCount()
        val total = tracks.size.toFloat()
        val sorted = counts.entries.sortedByDescending { it.value }
        val head = sorted.take(maxSlices).map { GenreSlice(it.key, it.value, it.value / total) }
        val tailCount = sorted.drop(maxSlices).sumOf { it.value }
        return if (tailCount > 0) head + GenreSlice("Other", tailCount, tailCount / total) else head
    }

    fun computeDailyListening(
        history: List<PlayHistoryEntry>,
        nowMs: Long,
        days: Int = 14,
        tz: TimeZone = TimeZone.currentSystemDefault(),
    ): List<DailyListeningPoint> {
        val dayMs = 86_400_000L
        val byDay = history.groupBy { entry ->
            val dt = Instant.fromEpochMilliseconds(entry.playedAt).toLocalDateTime(tz)
            "${dt.year}-${dt.monthNumber.toString().padStart(2, '0')}-${dt.dayOfMonth.toString().padStart(2, '0')}"
        }
        return (days - 1 downTo 0).map { offset ->
            val ts = nowMs - offset * dayMs
            val dt = Instant.fromEpochMilliseconds(ts).toLocalDateTime(tz)
            val key = "${dt.year}-${dt.monthNumber.toString().padStart(2, '0')}-${dt.dayOfMonth.toString().padStart(2, '0')}"
            val entries = byDay[key].orEmpty()
            DailyListeningPoint(
                label = "${dt.monthNumber}/${dt.dayOfMonth}",
                dayKey = key,
                plays = entries.size,
                minutes = (entries.sumOf { it.listenedSeconds } / 60.0).toInt(),
            )
        }
    }

    fun computeWeeklyHabits(
        history: List<PlayHistoryEntry>,
        tz: TimeZone = TimeZone.currentSystemDefault(),
    ): List<WeeklyHabitPoint> {
        val labels = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
        val plays = IntArray(7)
        val seconds = DoubleArray(7)
        for (entry in history) {
            val idx = Instant.fromEpochMilliseconds(entry.playedAt).toLocalDateTime(tz).dayOfWeek.ordinal
            if (idx in 0..6) {
                plays[idx]++
                seconds[idx] += entry.listenedSeconds
            }
        }
        return labels.mapIndexed { i, label -> WeeklyHabitPoint(label, plays[i], (seconds[i] / 60.0).toInt()) }
    }

    fun computeWeeklyTracksAdded(tracks: List<LocalTrack>, nowMs: Long, weeks: Int = 8): List<WeeklyAddedPoint> {
        val weekMs = 7L * 86_400_000L
        return (weeks - 1 downTo 0).map { w ->
            val start = nowMs - (w + 1) * weekMs
            val end = nowMs - w * weekMs
            val count = tracks.count { it.addedAt in start..end }
            WeeklyAddedPoint(if (w == 0) "This wk" else "-${w}w", count)
        }
    }

    fun computeActivityHeatmap(
        history: List<PlayHistoryEntry>,
        nowMs: Long,
        weeks: Int = 12,
        tz: TimeZone = TimeZone.currentSystemDefault(),
    ): List<HeatmapCell> {
        val totalDays = weeks * 7
        val daily = computeDailyListening(history, nowMs, totalDays, tz)
        val maxPlays = daily.maxOfOrNull { it.plays }?.coerceAtLeast(1) ?: 1
        return daily.map { pt ->
            val level = when {
                pt.plays <= 0 -> 0
                pt.plays <= maxPlays * 0.25 -> 1
                pt.plays <= maxPlays * 0.5 -> 2
                pt.plays <= maxPlays * 0.75 -> 3
                else -> 4
            }
            HeatmapCell(pt.dayKey, pt.plays, level)
        }
    }

    fun computeAlbumGallery(tracks: List<LocalTrack>): List<AlbumGalleryItem> =
        tracks.filter { it.album.isNotBlank() && !it.album.equals("Unknown Album", ignoreCase = true) }
            .groupBy { "${it.album.trim().lowercase()}::${it.artist.trim().lowercase()}" }
            .values
            .map { group ->
                val first = group.first()
                AlbumGalleryItem(
                    album = first.album,
                    artist = first.artist,
                    year = first.year,
                    coverArtUrl = group.firstNotNullOfOrNull { it.coverArtUrl },
                    trackIds = group.map { it.id },
                )
            }
            .sortedByDescending { it.trackIds.size }

    fun computeTrackStats(tracks: List<LocalTrack>, playStats: Map<String, TrackPlayStats>): TrackStatsSummary {
        val totalPlays = playStats.values.sumOf { it.playCount }
        val top = tracks.map { t -> t to (playStats[t.id]?.playCount ?: t.playCount ?: 0) }
            .filter { it.second > 0 }
            .sortedByDescending { it.second }
            .take(8)
        return TrackStatsSummary(
            totalTracks = tracks.size,
            matchedTracks = tracks.count { !it.youtubeVideoId.isNullOrBlank() },
            missingTracks = tracks.count { it.isMissingOnDevice },
            losslessCount = tracks.count { it.format.uppercase() in LOSSLESS },
            totalBytes = tracks.sumOf { it.fileSize },
            totalDurationSec = tracks.sumOf { it.duration },
            totalPlays = totalPlays,
            topTracks = top,
        )
    }

    fun recommendForYou(
        tracks: List<LocalTrack>,
        playStats: Map<String, TrackPlayStats>,
        limit: Int = 12,
    ): List<LocalTrack> {
        val genreAffinity = mutableMapOf<String, Int>()
        for (t in tracks) {
            val plays = playStats[t.id]?.playCount ?: t.playCount ?: 0
            if (plays > 0) {
                val g = inferTrackGenre(t).genre
                genreAffinity[g] = (genreAffinity[g] ?: 0) + plays
            }
        }
        val favGenres = genreAffinity.entries.sortedByDescending { it.value }.take(3).map { it.key }.toSet()
        return tracks
            .filterNot { it.isMissingOnDevice }
            .sortedByDescending { t ->
                val plays = playStats[t.id]?.playCount ?: t.playCount ?: 0
                val gBonus = if (inferTrackGenre(t).genre in favGenres) 40 else 0
                val freshBonus = if (plays == 0) 25 else maxOf(0, 15 - plays * 2)
                val ytBonus = if (!t.youtubeVideoId.isNullOrBlank()) 5 else 0
                gBonus + freshBonus + ytBonus
            }
            .take(limit)
    }
}
