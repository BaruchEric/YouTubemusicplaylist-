package com.cratesync.core

import com.cratesync.model.ScanLogEntry
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

object ScanLogFormatter {
    private val prettyJson = Json { prettyPrint = true; encodeDefaults = true }

    fun exportJson(entries: List<ScanLogEntry>): String = prettyJson.encodeToString(entries)

    fun formatDuration(ms: Long): String = when {
        ms < 1000L -> "${ms}ms"
        ms < 60_000L -> "${(ms / 100L) / 10.0}s"
        else -> "${ms / 60_000L}m ${(ms % 60_000L) / 1000L}s"
    }

    fun formatDurationSeconds(seconds: Double): String {
        val total = seconds.toInt().coerceAtLeast(0)
        val hrs = total / 3600
        val mins = (total % 3600) / 60
        val secs = total % 60
        return if (hrs > 0) {
            "$hrs:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}"
        } else {
            "$mins:${secs.toString().padStart(2, '0')}"
        }
    }

    fun formatBytes(bytes: Long): String {
        if (bytes < 1024L) return "$bytes B"
        val kb = bytes / 1024.0
        if (kb < 1024.0) return "${(kb * 10).toInt() / 10.0} KB"
        val mb = kb / 1024.0
        if (mb < 1024.0) return "${(mb * 10).toInt() / 10.0} MB"
        val gb = mb / 1024.0
        return "${(gb * 100).toInt() / 100.0} GB"
    }
}
