package com.cratesync.core

import com.cratesync.model.LocalTrack
import com.cratesync.model.TrackPlayStats
import kotlin.math.exp
import kotlin.random.Random

/**
 * Weighted Smart Shuffle favoring less-recently-played tracks, avoiding back-to-back artist
 * repeats, and gently diversifying genres across the listening session.
 */
object SmartShuffle {

    fun orderQueue(
        tracks: List<LocalTrack>,
        anchorTrackId: String?,
        playStats: Map<String, TrackPlayStats>,
        nowMs: Long,
        random: Random = Random.Default,
    ): List<LocalTrack> {
        if (tracks.size <= 1) return tracks
        val remaining = tracks.toMutableList()
        val ordered = mutableListOf<LocalTrack>()

        if (anchorTrackId != null) {
            val anchorIdx = remaining.indexOfFirst { it.id == anchorTrackId }
            if (anchorIdx >= 0) ordered += remaining.removeAt(anchorIdx)
        }

        val recentArtists = ArrayDeque<String>()
        val recentGenres = ArrayDeque<String>()
        ordered.firstOrNull()?.let {
            recentArtists.addLast(it.artist.lowercase())
            recentGenres.addLast(inferTrackGenre(it).genre.lowercase())
        }

        while (remaining.isNotEmpty()) {
            val weights = DoubleArray(remaining.size) { i ->
                val t = remaining[i]
                val stats = playStats[t.id]
                val lastPlayed = stats?.lastPlayedAt ?: t.lastPlayedAt ?: 0L
                val hoursSincePlay = if (lastPlayed <= 0L) 720.0 else ((nowMs - lastPlayed).coerceAtLeast(0L) / 3_600_000.0)
                val recencyFactor = 0.25 + (1.0 - exp(-hoursSincePlay / 24.0))
                val skipPenalty = 1.0 / (1.0 + (stats?.skipCount ?: 0) * 0.25)
                val artistPenalty = if (t.artist.lowercase() in recentArtists) 0.12 else 1.0
                val genrePenalty = if (inferTrackGenre(t).genre.lowercase() in recentGenres) 0.65 else 1.0
                (recencyFactor * skipPenalty * artistPenalty * genrePenalty).coerceAtLeast(0.01)
            }
            val total = weights.sum()
            var pick = random.nextDouble() * total
            var chosenIdx = remaining.lastIndex
            for (i in weights.indices) {
                pick -= weights[i]
                if (pick <= 0.0) {
                    chosenIdx = i
                    break
                }
            }
            val next = remaining.removeAt(chosenIdx)
            ordered += next
            recentArtists.addLast(next.artist.lowercase())
            if (recentArtists.size > 3) recentArtists.removeFirst()
            recentGenres.addLast(inferTrackGenre(next).genre.lowercase())
            if (recentGenres.size > 2) recentGenres.removeFirst()
        }
        return ordered
    }
}
