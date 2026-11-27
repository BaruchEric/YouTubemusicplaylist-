package com.cratesync.core

import kotlin.math.min

data class ParsedAudioTags(
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val genre: String? = null,
    val year: String? = null,
    val trackNumber: Int? = null,
    val durationSeconds: Double = 0.0,
    val coverArtBytes: ByteArray? = null,
    val coverArtMime: String? = null,
)

/**
 * Pure-Kotlin binary parser for ID3v2, ID3v1, FLAC, MP4/M4A, and WAV containers.
 * Works on full local buffers or partial HTTP byte-range headers from Google Drive.
 */
object BinaryAudioParser {

    fun parseHeaderAndTail(
        head: ByteArray,
        tail: ByteArray? = null,
        totalFileSize: Long = head.size.toLong(),
        fileName: String = "",
    ): ParsedAudioTags {
        val ext = extractAudioFormat(fileName).lowercase()
        val parsed = when {
            startsWithAscii(head, "ID3") -> parseId3v2AndMp3(head, totalFileSize)
            startsWithAscii(head, "fLaC") -> parseFlac(head)
            startsWithAscii(head, "RIFF") && head.size >= 12 && asciiAt(head, 8, 4) == "WAVE" -> parseWav(head)
            head.size >= 8 && asciiAt(head, 4, 4) == "ftyp" -> parseMp4(head)
            ext == "mp3" -> parseMp3FrameDuration(head, 0, totalFileSize)
            else -> ParsedAudioTags()
        }

        val withTail = if (tail != null && tail.size >= 128 && (parsed.title.isNullOrBlank() || parsed.artist.isNullOrBlank())) {
            val id3v1 = parseId3v1(tail)
            parsed.copy(
                title = parsed.title ?: id3v1.title,
                artist = parsed.artist ?: id3v1.artist,
                album = parsed.album ?: id3v1.album,
                year = parsed.year ?: id3v1.year,
                genre = parsed.genre ?: id3v1.genre,
                trackNumber = parsed.trackNumber ?: id3v1.trackNumber,
            )
        } else {
            parsed
        }

        return applyFileNameFallback(withTail, fileName)
    }

    fun applyFileNameFallback(tags: ParsedAudioTags, fileName: String): ParsedAudioTags {
        if (!tags.title.isNullOrBlank() && !tags.artist.isNullOrBlank()) return tags
        val base = fileName.substringBeforeLast('.').trim()
        if (base.isEmpty()) return tags
        val cleaned = base.replace(Regex("^\\d{1,3}\\s*[-._)]\\s*"), "")
        val parts = cleaned.split(Regex("\\s+[-–—]\\s+"))
        val inferredArtist = if (parts.size >= 2) parts.first().trim() else null
        val inferredTitle = if (parts.size >= 2) parts.drop(1).joinToString(" - ").trim() else cleaned
        val inferredTrack = Regex("^(\\d{1,3})\\s*[-._)]\\s*").find(base)?.groupValues?.get(1)?.toIntOrNull()

        return tags.copy(
            title = tags.title?.takeIf { it.isNotBlank() } ?: inferredTitle,
            artist = tags.artist?.takeIf { it.isNotBlank() } ?: inferredArtist ?: "Unknown Artist",
            album = tags.album?.takeIf { it.isNotBlank() } ?: "Unknown Album",
            trackNumber = tags.trackNumber ?: inferredTrack,
        )
    }

    private fun parseId3v2AndMp3(bytes: ByteArray, totalSize: Long): ParsedAudioTags {
        if (bytes.size < 10) return ParsedAudioTags()
        val major = bytes[3].toInt() and 0xff
        val tagSize = syncSafeInt(bytes, 6)
        val endOffset = min(bytes.size, 10 + tagSize)
        var offset = 10

        var title: String? = null
        var artist: String? = null
        var album: String? = null
        var genre: String? = null
        var year: String? = null
        var trackNum: Int? = null
        var coverBytes: ByteArray? = null
        var coverMime: String? = null

        val headerSize = if (major >= 3) 10 else 6
        while (offset + headerSize <= endOffset) {
            val frameId = if (major >= 3) asciiAt(bytes, offset, 4) else asciiAt(bytes, offset, 3)
            if (frameId.isEmpty() || frameId.all { it == '\u0000' }) break

            val frameSize = when {
                major == 4 -> syncSafeInt(bytes, offset + 4)
                major == 3 -> beInt(bytes, offset + 4)
                else -> beInt24(bytes, offset + 3)
            }
            if (frameSize <= 0 || offset + headerSize + frameSize > bytes.size) break
            val payloadStart = offset + headerSize
            val payloadEnd = payloadStart + frameSize

            when (frameId) {
                "TIT2", "TT2" -> title = decodeId3Text(bytes, payloadStart, payloadEnd)
                "TPE1", "TP1" -> artist = decodeId3Text(bytes, payloadStart, payloadEnd)
                "TALB", "TAL" -> album = decodeId3Text(bytes, payloadStart, payloadEnd)
                "TCON", "TCO" -> genre = normalizeCanonicalGenre(decodeId3Text(bytes, payloadStart, payloadEnd))
                "TYER", "TDRC", "TYE" -> year = extractYear(decodeId3Text(bytes, payloadStart, payloadEnd))
                "TRCK", "TRK" -> trackNum = decodeId3Text(bytes, payloadStart, payloadEnd)?.substringBefore('/')?.toIntOrNull()
                "APIC" -> {
                    val pic = decodeApicFrame(bytes, payloadStart, payloadEnd)
                    if (pic != null && coverBytes == null) {
                        coverMime = pic.first
                        coverBytes = pic.second
                    }
                }
            }
            offset = payloadEnd
        }

        val duration = parseMp3FrameDuration(bytes, min(bytes.size, 10 + tagSize), totalSize).durationSeconds
        return ParsedAudioTags(
            title = title,
            artist = artist,
            album = album,
            genre = genre,
            year = year,
            trackNumber = trackNum,
            durationSeconds = duration,
            coverArtBytes = coverBytes,
            coverArtMime = coverMime,
        )
    }

    private fun parseMp3FrameDuration(bytes: ByteArray, startOffset: Int, totalSize: Long): ParsedAudioTags {
        val bitrateTableV1L3 = intArrayOf(0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0)
        val limit = min(bytes.size - 4, startOffset + 16_384)
        var i = startOffset
        while (i <= limit) {
            val b0 = bytes[i].toInt() and 0xff
            val b1 = bytes[i + 1].toInt() and 0xff
            if (b0 == 0xff && (b1 and 0xe0) == 0xe0) {
                val versionBits = (b1 ushr 3) and 0x03
                val layerBits = (b1 ushr 1) and 0x03
                val b2 = bytes[i + 2].toInt() and 0xff
                val bitrateIdx = (b2 ushr 4) and 0x0f
                if (versionBits == 3 && layerBits == 1 && bitrateIdx in 1..14) {
                    val kbps = bitrateTableV1L3[bitrateIdx]
                    if (kbps > 0 && totalSize > startOffset) {
                        val audioBytes = (totalSize - startOffset).coerceAtLeast(0L)
                        val seconds = (audioBytes * 8.0) / (kbps * 1000.0)
                        return ParsedAudioTags(durationSeconds = seconds)
                    }
                }
            }
            i++
        }
        return ParsedAudioTags()
    }

    private fun parseId3v1(tail: ByteArray): ParsedAudioTags {
        val base = tail.size - 128
        if (base < 0 || asciiAt(tail, base, 3) != "TAG") return ParsedAudioTags()
        val title = latin1Trimmed(tail, base + 3, 30)
        val artist = latin1Trimmed(tail, base + 33, 30)
        val album = latin1Trimmed(tail, base + 63, 30)
        val year = extractYear(latin1Trimmed(tail, base + 93, 4))
        val trackNum = if (tail[base + 125].toInt() == 0 && tail[base + 126].toInt() != 0) {
            tail[base + 126].toInt() and 0xff
        } else {
            null
        }
        val genre = mapId3v1GenreIndex(tail[base + 127].toInt() and 0xff)
        return ParsedAudioTags(title, artist, album, genre, year, trackNum)
    }

    private fun parseFlac(bytes: ByteArray): ParsedAudioTags {
        var offset = 4
        var title: String? = null
        var artist: String? = null
        var album: String? = null
        var genre: String? = null
        var year: String? = null
        var trackNum: Int? = null
        var duration = 0.0
        var coverBytes: ByteArray? = null
        var coverMime: String? = null

        while (offset + 4 <= bytes.size) {
            val header = bytes[offset].toInt() and 0xff
            val isLast = (header and 0x80) != 0
            val blockType = header and 0x7f
            val length = beInt24(bytes, offset + 1)
            val dataStart = offset + 4
            val dataEnd = dataStart + length
            if (dataEnd > bytes.size) break

            when (blockType) {
                0 -> if (length >= 18) { // STREAMINFO
                    val srHi = (bytes[dataStart + 10].toInt() and 0xff) shl 12
                    val srMid = (bytes[dataStart + 11].toInt() and 0xff) shl 4
                    val srLo = (bytes[dataStart + 12].toInt() and 0xf0) ushr 4
                    val sampleRate = srHi or srMid or srLo
                    val totalSamples = ((bytes[dataStart + 13].toLong() and 0x0fL) shl 32) or
                        ((bytes[dataStart + 14].toLong() and 0xffL) shl 24) or
                        ((bytes[dataStart + 15].toLong() and 0xffL) shl 16) or
                        ((bytes[dataStart + 16].toLong() and 0xffL) shl 8) or
                        (bytes[dataStart + 17].toLong() and 0xffL)
                    if (sampleRate > 0 && totalSamples > 0) {
                        duration = totalSamples.toDouble() / sampleRate.toDouble()
                    }
                }
                4 -> { // VORBIS_COMMENT
                    var pos = dataStart
                    if (pos + 4 <= dataEnd) {
                        val vendorLen = leInt(bytes, pos)
                        pos += 4 + vendorLen
                    }
                    if (pos + 4 <= dataEnd) {
                        val commentCount = leInt(bytes, pos)
                        pos += 4
                        repeat(commentCount.coerceAtMost(512)) {
                            if (pos + 4 > dataEnd) return@repeat
                            val len = leInt(bytes, pos)
                            pos += 4
                            if (len <= 0 || pos + len > dataEnd) return@repeat
                            val entry = bytes.decodeToString(pos, pos + len)
                            pos += len
                            val eq = entry.indexOf('=')
                            if (eq > 0) {
                                val k = entry.substring(0, eq).uppercase()
                                val v = entry.substring(eq + 1).trim()
                                when (k) {
                                    "TITLE" -> title = v
                                    "ARTIST" -> artist = v
                                    "ALBUM" -> album = v
                                    "GENRE" -> genre = normalizeCanonicalGenre(v)
                                    "DATE", "YEAR" -> year = extractYear(v)
                                    "TRACKNUMBER" -> trackNum = v.substringBefore('/').toIntOrNull()
                                }
                            }
                        }
                    }
                }
                6 -> if (coverBytes == null && length >= 32) { // PICTURE
                    var pos = dataStart + 4
                    val mimeLen = beInt(bytes, pos)
                    pos += 4
                    if (mimeLen in 1..128 && pos + mimeLen <= dataEnd) {
                        val mime = asciiAt(bytes, pos, mimeLen)
                        pos += mimeLen
                        val descLen = beInt(bytes, pos)
                        pos += 4 + descLen + 16
                        if (pos + 4 <= dataEnd) {
                            val dataLen = beInt(bytes, pos)
                            pos += 4
                            if (dataLen > 0 && pos + dataLen <= dataEnd) {
                                coverMime = mime
                                coverBytes = bytes.copyOfRange(pos, pos + dataLen)
                            }
                        }
                    }
                }
            }
            offset = dataEnd
            if (isLast) break
        }
        return ParsedAudioTags(title, artist, album, genre, year, trackNum, duration, coverBytes, coverMime)
    }

    private fun parseWav(bytes: ByteArray): ParsedAudioTags {
        var offset = 12
        var byteRate = 0
        var dataSize = 0
        var title: String? = null
        var artist: String? = null
        var album: String? = null
        var genre: String? = null
        var year: String? = null

        while (offset + 8 <= bytes.size) {
            val id = asciiAt(bytes, offset, 4)
            val size = leInt(bytes, offset + 4)
            val dataStart = offset + 8
            val dataEnd = min(bytes.size, dataStart + size)
            when (id) {
                "fmt " -> if (size >= 16 && dataStart + 12 <= bytes.size) {
                    byteRate = leInt(bytes, dataStart + 8)
                }
                "data" -> dataSize = size
                "LIST" -> if (dataStart + 4 <= dataEnd && asciiAt(bytes, dataStart, 4) == "INFO") {
                    var pos = dataStart + 4
                    while (pos + 8 <= dataEnd) {
                        val subId = asciiAt(bytes, pos, 4)
                        val subSize = leInt(bytes, pos + 4)
                        val subStart = pos + 8
                        val subEnd = min(dataEnd, subStart + subSize)
                        val text = latin1Trimmed(bytes, subStart, subEnd - subStart)
                        when (subId) {
                            "INAM" -> title = text
                            "IART" -> artist = text
                            "IPRD" -> album = text
                            "IGNR" -> genre = normalizeCanonicalGenre(text)
                            "ICRD" -> year = extractYear(text)
                        }
                        pos = subEnd + (subSize and 1)
                    }
                }
            }
            offset = dataStart + size + (size and 1)
            if (size < 0) break
        }

        val duration = if (byteRate > 0 && dataSize > 0) dataSize.toDouble() / byteRate.toDouble() else 0.0
        return ParsedAudioTags(title, artist, album, genre, year, null, duration)
    }

    private fun parseMp4(bytes: ByteArray): ParsedAudioTags {
        var title: String? = null
        var artist: String? = null
        var album: String? = null
        var genre: String? = null
        var year: String? = null
        var trackNum: Int? = null
        var duration = 0.0

        fun walkAtoms(start: Int, end: Int) {
            var pos = start
            while (pos + 8 <= end) {
                val rawSize = beInt(bytes, pos)
                val type = asciiAt(bytes, pos + 4, 4)
                val atomEnd = if (rawSize == 0) end else min(end, pos + rawSize)
                if (rawSize < 8 || atomEnd <= pos) break
                val bodyStart = pos + 8
                when (type) {
                    "moov", "udta", "ilst" -> walkAtoms(bodyStart, atomEnd)
                    "meta" -> if (bodyStart + 4 < atomEnd) walkAtoms(bodyStart + 4, atomEnd)
                    "mvhd" -> if (bodyStart + 20 <= atomEnd) {
                        val version = bytes[bodyStart].toInt() and 0xff
                        if (version == 0 && bodyStart + 20 <= atomEnd) {
                            val timescale = beInt(bytes, bodyStart + 12)
                            val dur = beInt(bytes, bodyStart + 16)
                            if (timescale > 0 && dur > 0) duration = dur.toDouble() / timescale.toDouble()
                        }
                    }
                    "\u00a9nam", "\u00a9ART", "\u00a9alb", "\u00a9gen", "\u00a9day", "trkn" -> {
                        val dataVal = readMp4DataAtom(bytes, bodyStart, atomEnd)
                        if (dataVal != null) {
                            when (type) {
                                "\u00a9nam" -> title = dataVal.decodeToString().trim()
                                "\u00a9ART" -> artist = dataVal.decodeToString().trim()
                                "\u00a9alb" -> album = dataVal.decodeToString().trim()
                                "\u00a9gen" -> genre = normalizeCanonicalGenre(dataVal.decodeToString().trim())
                                "\u00a9day" -> year = extractYear(dataVal.decodeToString().trim())
                                "trkn" -> if (dataVal.size >= 4) {
                                    trackNum = ((dataVal[2].toInt() and 0xff) shl 8) or (dataVal[3].toInt() and 0xff)
                                }
                            }
                        }
                    }
                }
                pos = atomEnd
            }
        }

        walkAtoms(0, bytes.size)
        return ParsedAudioTags(title, artist, album, genre, year, trackNum, duration)
    }

    private fun readMp4DataAtom(bytes: ByteArray, start: Int, end: Int): ByteArray? {
        var pos = start
        while (pos + 16 <= end) {
            val size = beInt(bytes, pos)
            val type = asciiAt(bytes, pos + 4, 4)
            if (size < 16 || pos + size > end) break
            if (type == "data") {
                return bytes.copyOfRange(pos + 16, pos + size)
            }
            pos += size
        }
        return null
    }

    private fun decodeApicFrame(bytes: ByteArray, start: Int, end: Int): Pair<String, ByteArray>? {
        if (start + 4 >= end) return null
        val encoding = bytes[start].toInt() and 0xff
        var pos = start + 1
        val mimeStart = pos
        while (pos < end && bytes[pos].toInt() != 0) pos++
        val mime = asciiAt(bytes, mimeStart, pos - mimeStart).ifBlank { "image/jpeg" }
        pos += 2 // null terminator + picture type byte
        if (encoding == 1 || encoding == 2) {
            while (pos + 1 < end && !(bytes[pos].toInt() == 0 && bytes[pos + 1].toInt() == 0)) pos += 2
            pos += 2
        } else {
            while (pos < end && bytes[pos].toInt() != 0) pos++
            pos += 1
        }
        if (pos >= end) return null
        return mime to bytes.copyOfRange(pos, end)
    }

    private fun decodeId3Text(bytes: ByteArray, start: Int, end: Int): String? {
        if (start >= end) return null
        val encoding = bytes[start].toInt() and 0xff
        val payloadStart = start + 1
        if (payloadStart >= end) return null
        val raw = when (encoding) {
            0 -> latin1Trimmed(bytes, payloadStart, end - payloadStart)
            3 -> bytes.decodeToString(payloadStart, end).trim('\u0000', ' ')
            1, 2 -> decodeUtf16(bytes, payloadStart, end)
            else -> bytes.decodeToString(payloadStart, end).trim('\u0000', ' ')
        }
        return raw?.takeIf { it.isNotBlank() }
    }

    private fun decodeUtf16(bytes: ByteArray, start: Int, end: Int): String {
        var pos = start
        var littleEndian = false
        if (pos + 2 <= end) {
            val b0 = bytes[pos].toInt() and 0xff
            val b1 = bytes[pos + 1].toInt() and 0xff
            if (b0 == 0xff && b1 == 0xfe) {
                littleEndian = true
                pos += 2
            } else if (b0 == 0xfe && b1 == 0xff) {
                littleEndian = false
                pos += 2
            }
        }
        val sb = StringBuilder()
        while (pos + 1 < end) {
            val hi = bytes[pos].toInt() and 0xff
            val lo = bytes[pos + 1].toInt() and 0xff
            val ch = if (littleEndian) (lo shl 8) or hi else (hi shl 8) or lo
            if (ch == 0) break
            sb.append(ch.toChar())
            pos += 2
        }
        return sb.toString().trim()
    }

    private fun extractYear(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        return Regex("\\b(19\\d{2}|20\\d{2})\\b").find(raw)?.groupValues?.get(1)
    }

    private fun startsWithAscii(bytes: ByteArray, text: String): Boolean {
        if (bytes.size < text.length) return false
        for (i in text.indices) {
            if ((bytes[i].toInt() and 0xff) != text[i].code) return false
        }
        return true
    }

    private fun asciiAt(bytes: ByteArray, offset: Int, len: Int): String {
        if (offset < 0 || offset + len > bytes.size) return ""
        val chars = CharArray(len) { i -> (bytes[offset + i].toInt() and 0xff).toChar() }
        return chars.concatToString()
    }

    private fun latin1Trimmed(bytes: ByteArray, offset: Int, len: Int): String? {
        if (offset < 0 || len <= 0 || offset + len > bytes.size) return null
        val sb = StringBuilder(len)
        for (i in 0 until len) {
            val c = bytes[offset + i].toInt() and 0xff
            if (c == 0) break
            sb.append(c.toChar())
        }
        return sb.toString().trim().takeIf { it.isNotEmpty() }
    }

    private fun syncSafeInt(b: ByteArray, offset: Int): Int =
        ((b[offset].toInt() and 0x7f) shl 21) or
            ((b[offset + 1].toInt() and 0x7f) shl 14) or
            ((b[offset + 2].toInt() and 0x7f) shl 7) or
            (b[offset + 3].toInt() and 0x7f)

    private fun beInt(b: ByteArray, offset: Int): Int =
        ((b[offset].toInt() and 0xff) shl 24) or
            ((b[offset + 1].toInt() and 0xff) shl 16) or
            ((b[offset + 2].toInt() and 0xff) shl 8) or
            (b[offset + 3].toInt() and 0xff)

    private fun beInt24(b: ByteArray, offset: Int): Int =
        ((b[offset].toInt() and 0xff) shl 16) or
            ((b[offset + 1].toInt() and 0xff) shl 8) or
            (b[offset + 2].toInt() and 0xff)

    private fun leInt(b: ByteArray, offset: Int): Int =
        (b[offset].toInt() and 0xff) or
            ((b[offset + 1].toInt() and 0xff) shl 8) or
            ((b[offset + 2].toInt() and 0xff) shl 16) or
            ((b[offset + 3].toInt() and 0xff) shl 24)
}
