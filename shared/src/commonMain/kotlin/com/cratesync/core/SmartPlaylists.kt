package com.cratesync.core

import com.cratesync.model.LocalTrack
import com.cratesync.model.MatchStatus
import com.cratesync.model.SmartPlaylist
import com.cratesync.model.SmartPlaylistMatchMode
import com.cratesync.model.SmartPlaylistRule
import com.cratesync.model.SmartPlaylistSortBy
import com.cratesync.model.SmartPlaylistSortDir
import com.cratesync.model.SmartRuleField
import com.cratesync.model.SmartRuleOperator
import com.cratesync.model.TrackPlayStats
import com.cratesync.platform.currentTimeMillis
import com.cratesync.platform.randomUuid
import kotlin.math.abs

data class SmartPlaylistPreset(
    val id: String,
    val label: String,
    val name: String,
    val description: String,
    val matchMode: SmartPlaylistMatchMode,
    val rules: List<Triple<SmartRuleField, SmartRuleOperator, String>>,
    val sortBy: SmartPlaylistSortBy,
    val sortDir: SmartPlaylistSortDir,
    val excludeMissing: Boolean = true,
)

object SmartPlaylists {

    val PRESETS = listOf(
        SmartPlaylistPreset(
            id = "most-played",
            label = "Most Played",
            name = "Heavy Rotation",
            description = "Tracks played at least once, ordered by play count.",
            matchMode = SmartPlaylistMatchMode.ALL,
            rules = listOf(Triple(SmartRuleField.PLAY_COUNT, SmartRuleOperator.GTE, "1")),
            sortBy = SmartPlaylistSortBy.PLAY_COUNT,
            sortDir = SmartPlaylistSortDir.DESC,
        ),
        SmartPlaylistPreset(
            id = "lossless-vault",
            label = "Lossless Vault",
            name = "Lossless Audio",
            description = "FLAC, WAV, and AIFF masters from device storage.",
            matchMode = SmartPlaylistMatchMode.ANY,
            rules = listOf(
                Triple(SmartRuleField.FORMAT, SmartRuleOperator.EQUALS, "FLAC"),
                Triple(SmartRuleField.FORMAT, SmartRuleOperator.EQUALS, "WAV"),
                Triple(SmartRuleField.FORMAT, SmartRuleOperator.EQUALS, "AIFF"),
            ),
            sortBy = SmartPlaylistSortBy.ADDED_AT,
            sortDir = SmartPlaylistSortDir.DESC,
        ),
        SmartPlaylistPreset(
            id = "yt-ready",
            label = "YouTube Ready",
            name = "Matched for YouTube Music",
            description = "Verified local tracks ready to launch in YouTube Music.",
            matchMode = SmartPlaylistMatchMode.ALL,
            rules = listOf(Triple(SmartRuleField.MATCH_STATUS, SmartRuleOperator.EQUALS, "matched")),
            sortBy = SmartPlaylistSortBy.PLAY_COUNT,
            sortDir = SmartPlaylistSortDir.DESC,
        ),
        SmartPlaylistPreset(
            id = "recently-added",
            label = "Fresh Crates (14d)",
            name = "Fresh Crates",
            description = "Tracks imported or discovered in the last 14 days.",
            matchMode = SmartPlaylistMatchMode.ALL,
            rules = listOf(Triple(SmartRuleField.ADDED_DAYS_AGO, SmartRuleOperator.LTE, "14")),
            sortBy = SmartPlaylistSortBy.ADDED_AT,
            sortDir = SmartPlaylistSortDir.DESC,
        ),
        SmartPlaylistPreset(
            id = "extended-mixes",
            label = "Long Mixes (5m+)",
            name = "Extended Cuts",
            description = "Longer tracks and extended mixes over 5 minutes.",
            matchMode = SmartPlaylistMatchMode.ALL,
            rules = listOf(Triple(SmartRuleField.DURATION, SmartRuleOperator.GTE, "5:00")),
            sortBy = SmartPlaylistSortBy.DURATION,
            sortDir = SmartPlaylistSortDir.DESC,
        ),
    )

    fun fromPreset(preset: SmartPlaylistPreset, now: Long = currentTimeMillis()): SmartPlaylist =
        SmartPlaylist(
            id = randomUuid(),
            name = preset.name,
            description = preset.description,
            matchMode = preset.matchMode,
            rules = preset.rules.map { (f, op, v) -> SmartPlaylistRule(randomUuid(), f, op, v) },
            sortBy = preset.sortBy,
            sortDir = preset.sortDir,
            excludeMissing = preset.excludeMissing,
            createdAt = now,
            updatedAt = now,
        )

    fun parseDurationSeconds(raw: String): Double? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null
        if (':' in trimmed) {
            val parts = trimmed.split(':').map { it.trim().toDoubleOrNull() ?: return null }
            if (parts.any { it < 0.0 }) return null
            return when (parts.size) {
                2 -> parts[0] * 60.0 + parts[1]
                3 -> parts[0] * 3600.0 + parts[1] * 60.0 + parts[2]
                else -> null
            }
        }
        return trimmed.toDoubleOrNull()?.takeIf { it >= 0.0 }
    }

    private fun compareText(actual: String, op: SmartRuleOperator, rawTarget: String): Boolean {
        val target = rawTarget.trim().lowercase()
        if (target.isEmpty()) return true
        val norm = actual.trim().lowercase()
        return when (op) {
            SmartRuleOperator.CONTAINS -> norm.contains(target)
            SmartRuleOperator.NOT_CONTAINS -> !norm.contains(target)
            SmartRuleOperator.EQUALS -> norm == target
            SmartRuleOperator.NOT_EQUALS -> norm != target
            else -> norm.contains(target)
        }
    }

    private fun compareNumber(actual: Double?, op: SmartRuleOperator, target: Double?): Boolean {
        if (target == null) return true
        if (actual == null || !actual.isFinite()) return false
        return when (op) {
            SmartRuleOperator.GT -> actual > target
            SmartRuleOperator.GTE -> actual >= target
            SmartRuleOperator.LT -> actual < target
            SmartRuleOperator.LTE -> actual <= target
            SmartRuleOperator.EQUALS -> abs(actual - target) < 0.0001
            SmartRuleOperator.NOT_EQUALS -> abs(actual - target) >= 0.0001
            else -> false
        }
    }

    private fun effectivePlayCount(track: LocalTrack, playStats: Map<String, TrackPlayStats>): Int =
        playStats[track.id]?.playCount ?: track.playCount ?: 0

    private fun effectiveLastPlayed(track: LocalTrack, playStats: Map<String, TrackPlayStats>): Long =
        playStats[track.id]?.lastPlayedAt ?: track.lastPlayedAt ?: 0L

    private fun evaluateRule(
        rule: SmartPlaylistRule,
        track: LocalTrack,
        playStats: Map<String, TrackPlayStats>,
        nowMs: Long,
    ): Boolean = when (rule.field) {
        SmartRuleField.GENRE -> {
            val inferred = inferTrackGenre(track).genre
            val combined = if (!track.genre.isNullOrBlank()) "${track.genre} $inferred" else inferred
            if (rule.operator == SmartRuleOperator.EQUALS || rule.operator == SmartRuleOperator.NOT_EQUALS) {
                val target = rule.value.trim().lowercase()
                if (target.isEmpty()) true
                else {
                    val eq = inferred.lowercase() == target || (track.genre?.trim()?.lowercase() == target)
                    if (rule.operator == SmartRuleOperator.EQUALS) eq else !eq
                }
            } else {
                compareText(combined, rule.operator, rule.value)
            }
        }
        SmartRuleField.ARTIST -> compareText(track.artist, rule.operator, rule.value)
        SmartRuleField.ALBUM -> compareText(track.album, rule.operator, rule.value)
        SmartRuleField.TITLE -> compareText(track.title, rule.operator, rule.value)
        SmartRuleField.FORMAT -> compareText(track.format, rule.operator, rule.value)
        SmartRuleField.FOLDER_NAME -> compareText("${track.folderName} ${track.relativePath}", rule.operator, rule.value)
        SmartRuleField.MATCH_STATUS -> {
            val status = when {
                !track.youtubeVideoId.isNullOrBlank() -> "matched"
                track.matchStatus == MatchStatus.SKIPPED -> "skipped"
                else -> "unmatched"
            }
            compareText(status, rule.operator, rule.value)
        }
        SmartRuleField.PLAY_COUNT -> compareNumber(
            effectivePlayCount(track, playStats).toDouble(),
            rule.operator,
            rule.value.trim().toDoubleOrNull(),
        )
        SmartRuleField.DURATION -> compareNumber(
            track.duration.takeIf { it > 0.0 },
            rule.operator,
            parseDurationSeconds(rule.value),
        )
        SmartRuleField.YEAR -> compareNumber(
            track.year.take(4).toDoubleOrNull()?.takeIf { it > 0.0 },
            rule.operator,
            rule.value.trim().toDoubleOrNull(),
        )
        SmartRuleField.ADDED_DAYS_AGO -> {
            val daysAgo = ((nowMs - track.addedAt).coerceAtLeast(0L)) / 86_400_000.0
            compareNumber(daysAgo, rule.operator, rule.value.trim().toDoubleOrNull())
        }
    }

    fun evaluate(
        playlist: SmartPlaylist,
        tracks: List<LocalTrack>,
        playStats: Map<String, TrackPlayStats> = emptyMap(),
        nowMs: Long = currentTimeMillis(),
    ): List<LocalTrack> {
        val activeRules = playlist.rules.filter { it.value.trim().isNotEmpty() }
        val matched = tracks.filter { track ->
            if (playlist.excludeMissing && track.isMissingOnDevice) return@filter false
            if (activeRules.isEmpty()) return@filter true
            when (playlist.matchMode) {
                SmartPlaylistMatchMode.ALL -> activeRules.all { evaluateRule(it, track, playStats, nowMs) }
                SmartPlaylistMatchMode.ANY -> activeRules.any { evaluateRule(it, track, playStats, nowMs) }
            }
        }
        val dir = if (playlist.sortDir == SmartPlaylistSortDir.ASC) 1 else -1
        return matched.sortedWith { a, b ->
            val cmp = when (playlist.sortBy) {
                SmartPlaylistSortBy.PLAY_COUNT -> effectivePlayCount(a, playStats).compareTo(effectivePlayCount(b, playStats))
                SmartPlaylistSortBy.LAST_PLAYED_AT -> effectiveLastPlayed(a, playStats).compareTo(effectiveLastPlayed(b, playStats))
                SmartPlaylistSortBy.TITLE -> a.title.compareTo(b.title, ignoreCase = true)
                SmartPlaylistSortBy.ARTIST -> a.artist.compareTo(b.artist, ignoreCase = true)
                SmartPlaylistSortBy.DURATION -> a.duration.compareTo(b.duration)
                SmartPlaylistSortBy.YEAR -> (a.year.take(4).toIntOrNull() ?: 0).compareTo(b.year.take(4).toIntOrNull() ?: 0)
                SmartPlaylistSortBy.ADDED_AT -> a.addedAt.compareTo(b.addedAt)
            }
            if (cmp != 0) cmp * dir else a.title.compareTo(b.title, ignoreCase = true)
        }
    }
}
