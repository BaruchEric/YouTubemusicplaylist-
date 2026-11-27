package com.cratesync.core

import com.cratesync.model.LocalTrack

enum class IntegritySeverity { HEALTHY, WARNING, CORRUPTED }

data class TrackIntegrityReport(
    val trackId: String,
    val severity: IntegritySeverity,
    val detectedContainer: String,
    val issues: List<String>,
    val canRepairMetadata: Boolean,
    val repairedTags: ParsedAudioTags? = null,
)

/**
 * Inspects audio container headers (MP3/ID3, FLAC, MP4/M4A, WAV, OGG/Opus) for zero-byte files,
 * HTML/text error payloads disguised as audio, mismatched headers, and missing duration/tags.
 */
object AudioIntegrityScanner {

    fun inspectTrackBytes(track: LocalTrack, headBytes: ByteArray?): TrackIntegrityReport {
        if (headBytes == null) {
            return TrackIntegrityReport(
                trackId = track.id,
                severity = IntegritySeverity.WARNING,
                detectedContainer = "Unavailable",
                issues = listOf("Audio bytes are not currently accessible on this device."),
                canRepairMetadata = false,
            )
        }
        if (headBytes.isEmpty() || track.fileSize <= 0L) {
            return TrackIntegrityReport(
                trackId = track.id,
                severity = IntegritySeverity.CORRUPTED,
                detectedContainer = "Empty",
                issues = listOf("Zero-byte file cannot be decoded."),
                canRepairMetadata = false,
            )
        }
        val asciiHead = headBytes.copyOfRange(0, headBytes.size.coerceAtMost(32)).decodeToString().lowercase()
        if (asciiHead.contains("<!doctype") || asciiHead.contains("<html")) {
            return TrackIntegrityReport(
                trackId = track.id,
                severity = IntegritySeverity.CORRUPTED,
                detectedContainer = "HTML Error Page",
                issues = listOf("File begins with HTML markup instead of an audio container."),
                canRepairMetadata = false,
            )
        }

        val detected = detectContainer(headBytes)
        val issues = mutableListOf<String>()
        var severity = IntegritySeverity.HEALTHY

        if (detected == "Unknown") {
            severity = IntegritySeverity.CORRUPTED
            issues += "Unrecognized binary signature for ${track.format} file."
        } else if (!containerMatchesFormat(detected, track.format)) {
            severity = IntegritySeverity.WARNING
            issues += "Extension says ${track.format}, but binary header is $detected."
        }

        val parsed = BinaryAudioParser.parseHeaderAndTail(
            head = headBytes,
            totalFileSize = track.fileSize.coerceAtLeast(headBytes.size.toLong()),
            fileName = track.fileName,
        )
        val needsMetadataRepair =
            (track.duration <= 0.0 && parsed.durationSeconds > 0.0) ||
                (track.artist.equals("Unknown Artist", ignoreCase = true) && !parsed.artist.isNullOrBlank() && parsed.artist != "Unknown Artist") ||
                (track.album.equals("Unknown Album", ignoreCase = true) && !parsed.album.isNullOrBlank() && parsed.album != "Unknown Album")

        if (needsMetadataRepair) {
            if (severity == IntegritySeverity.HEALTHY) severity = IntegritySeverity.WARNING
            issues += "Embedded container tags/duration can be repaired into the catalog."
        }

        return TrackIntegrityReport(
            trackId = track.id,
            severity = severity,
            detectedContainer = detected,
            issues = issues,
            canRepairMetadata = needsMetadataRepair,
            repairedTags = if (needsMetadataRepair) parsed else null,
        )
    }

    fun applyRepair(track: LocalTrack, report: TrackIntegrityReport, now: Long): LocalTrack {
        val tags = report.repairedTags ?: return track
        return track.copy(
            title = tags.title?.takeIf { it.isNotBlank() } ?: track.title,
            artist = tags.artist?.takeIf { it.isNotBlank() && it != "Unknown Artist" } ?: track.artist,
            album = tags.album?.takeIf { it.isNotBlank() && it != "Unknown Album" } ?: track.album,
            genre = tags.genre ?: track.genre,
            year = tags.year?.takeIf { it.isNotBlank() } ?: track.year,
            duration = if (track.duration <= 0.0 && tags.durationSeconds > 0.0) tags.durationSeconds else track.duration,
            updatedAt = now,
        )
    }

    private fun detectContainer(bytes: ByteArray): String {
        if (bytes.size >= 4) {
            val s4 = bytes.copyOfRange(0, 4).decodeToString()
            if (s4.startsWith("ID3")) return "MP3/ID3"
            if (s4 == "fLaC") return "FLAC"
            if (s4 == "OggS") return "OGG"
            if (s4 == "RIFF" && bytes.size >= 12 && bytes.copyOfRange(8, 12).decodeToString() == "WAVE") return "WAV"
            if (s4 == "FORM" && bytes.size >= 12 && bytes.copyOfRange(8, 12).decodeToString() == "AIFF") return "AIFF"
        }
        if (bytes.size >= 8 && bytes.copyOfRange(4, 8).decodeToString() == "ftyp") return "MP4/M4A"
        if (bytes.size >= 2 && (bytes[0].toInt() and 0xff) == 0xff && ((bytes[1].toInt() and 0xe0) == 0xe0)) return "MP3"
        return "Unknown"
    }

    private fun containerMatchesFormat(container: String, format: String): Boolean {
        val fmt = format.uppercase()
        return when (container) {
            "MP3/ID3", "MP3" -> fmt == "MP3" || fmt == "AAC"
            "FLAC" -> fmt == "FLAC"
            "MP4/M4A" -> fmt in setOf("M4A", "MP4", "AAC", "ALAC")
            "WAV" -> fmt == "WAV"
            "OGG" -> fmt in setOf("OGG", "OGA", "OPUS")
            "AIFF" -> fmt in setOf("AIFF", "AIF", "AIFC")
            else -> false
        }
    }
}
