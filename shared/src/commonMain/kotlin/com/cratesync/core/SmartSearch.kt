package com.cratesync.core

import com.cratesync.model.LocalTrack
import com.cratesync.model.MatchStatus
import com.cratesync.model.Playlist
import com.cratesync.model.TrackPlayStats
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

enum class NumericOp { EQ, GT, GTE, LT, LTE, RANGE }

data class ParsedNumericComparison(
    val op: NumericOp,
    val min: Double,
    val max: Double? = null,
)

data class ParsedSmartQuery(
    val raw: String,
    val terms: List<String> = emptyList(),
    val excludedTerms: List<String> = emptyList(),
    val genres: List<String> = emptyList(),
    val excludedGenres: List<String> = emptyList(),
    val artists: List<String> = emptyList(),
    val albums: List<String> = emptyList(),
    val formats: List<String> = emptyList(),
    val folders: List<String> = emptyList(),
    val statuses: List<String> = emptyList(),
    val excludedStatuses: List<String> = emptyList(),
    val lossless: Boolean? = null,
    val hasArt: Boolean? = null,
    val played: Boolean? = null,
    val yearFilter: ParsedNumericComparison? = null,
    val playsFilter: ParsedNumericComparison? = null,
    val durationFilter: ParsedNumericComparison? = null,
    val activeDescriptors: List<String> = emptyList(),
)

data class SmartTrackResult(
    val track: LocalTrack,
    val genre: String,
    val score: Int,
    val matchedFields: List<String>,
)

data class SmartAlbumResult(
    val key: String,
    val album: String,
    val artist: String,
    val year: String,
    val coverArtUrl: String?,
    val trackIds: List<String>,
    val score: Int,
)

data class SmartGenreResult(
    val genre: String,
    val count: Int,
    val trackIds: List<String>,
    val score: Int,
)

data class GlobalSmartSearchResults(
    val parsed: ParsedSmartQuery,
    val tracks: List<SmartTrackResult>,
    val playlists: List<Playlist>,
    val albums: List<SmartAlbumResult>,
    val genres: List<SmartGenreResult>,
)

data class SmartSearchPreset(val label: String, val query: String, val hint: String)

object SmartSearch {
    private val LOSSLESS_FORMATS = setOf("FLAC", "WAV", "AIFF", "AIF", "AIFC", "ALAC")

    val PRESETS = listOf(
        SmartSearchPreset("Missing files", "is:missing", "Tracks missing on device"),
        SmartSearchPreset("Unmatched YT", "is:unmatched", "Needs YouTube Music ID"),
        SmartSearchPreset("Lossless audio", "lossless", "FLAC, WAV, AIFF, ALAC"),
        SmartSearchPreset("Played tracks", "plays:>0", "Tracks with recorded plays"),
        SmartSearchPreset("No cover art", "is:noart", "Missing embedded artwork"),
        SmartSearchPreset("Long tracks (5m+)", "duration:>5m", "Over 5 minutes"),
    )

    private fun tokenize(raw: String): List<String> =
        Regex("""(-?[a-zA-Z]+:"[^"]+"|-?"[^"]+"|\S+)""").findAll(raw.trim()).map { it.value }.toList()

    private fun stripQuotes(s: String): String =
        if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s.substring(1, s.length - 1) else s

    private fun parseDurationVal(raw: String): Double? {
        val cleaned = raw.trim().lowercase()
        Regex("""^(\d+):(\d{1,2})$""").matchEntire(cleaned)?.let { m ->
            return m.groupValues[1].toDouble() * 60.0 + m.groupValues[2].toDouble()
        }
        val m = Regex("""^(\d+(?:\.\d+)?)(m|min|mins|s|sec|secs)?$""").matchEntire(cleaned) ?: return null
        val n = m.groupValues[1].toDoubleOrNull() ?: return null
        val unit = m.groupValues[2].ifEmpty { "m" }
        return if (unit.startsWith("s")) n else n * 60.0
    }

    private fun parseNumeric(raw: String, parser: (String) -> Double?): ParsedNumericComparison? {
        val trimmed = raw.trim()
        Regex("""^([^-]+)-([^-]+)$""").matchEntire(trimmed)?.let { m ->
            val a = parser(m.groupValues[1])
            val b = parser(m.groupValues[2])
            if (a != null && b != null) return ParsedNumericComparison(NumericOp.RANGE, min(a, b), max(a, b))
        }
        val m = Regex("""^(>=|<=|>|<|=)?(.+)$""").matchEntire(trimmed) ?: return null
        val op = when (m.groupValues[1]) {
            ">" -> NumericOp.GT
            ">=" -> NumericOp.GTE
            "<" -> NumericOp.LT
            "<=" -> NumericOp.LTE
            else -> NumericOp.EQ
        }
        val num = parser(m.groupValues[2]) ?: return null
        return ParsedNumericComparison(op, num)
    }

    private fun matchesNumeric(actual: Double, cmp: ParsedNumericComparison): Boolean = when (cmp.op) {
        NumericOp.RANGE -> cmp.max != null && actual >= cmp.min && actual <= cmp.max
        NumericOp.GT -> actual > cmp.min
        NumericOp.GTE -> actual >= cmp.min
        NumericOp.LT -> actual < cmp.min
        NumericOp.LTE -> actual <= cmp.min
        NumericOp.EQ -> actual == cmp.min
    }

    fun parseQuery(raw: String): ParsedSmartQuery {
        val terms = mutableListOf<String>()
        val excludedTerms = mutableListOf<String>()
        val genres = mutableListOf<String>()
        val excludedGenres = mutableListOf<String>()
        val artists = mutableListOf<String>()
        val albums = mutableListOf<String>()
        val formats = mutableListOf<String>()
        val folders = mutableListOf<String>()
        val statuses = mutableListOf<String>()
        val excludedStatuses = mutableListOf<String>()
        val descriptors = mutableListOf<String>()
        var lossless: Boolean? = null
        var hasArt: Boolean? = null
        var played: Boolean? = null
        var yearFilter: ParsedNumericComparison? = null
        var playsFilter: ParsedNumericComparison? = null
        var durationFilter: ParsedNumericComparison? = null

        for (token in tokenize(raw)) {
            val isNeg = token.startsWith('-') && token.length > 1
            val body = if (isNeg) token.substring(1) else token
            val colon = body.indexOf(':')
            if (colon == -1) {
                if (body.equals("lossless", ignoreCase = true)) {
                    lossless = !isNeg
                    descriptors += if (isNeg) "Lossy only" else "Lossless audio"
                    continue
                }
                val clean = stripQuotes(body).trim().lowercase()
                if (clean.isEmpty()) continue
                if (isNeg) {
                    excludedTerms += clean
                    descriptors += "Exclude \"$clean\""
                } else {
                    terms += clean
                }
                continue
            }

            val key = body.substring(0, colon).lowercase()
            val valRaw = stripQuotes(body.substring(colon + 1)).trim()
            val value = valRaw.lowercase()
            if (value.isEmpty()) continue

            when (key) {
                "genre", "g" -> if (isNeg) {
                    excludedGenres += value; descriptors += "Not genre: $valRaw"
                } else {
                    genres += value; descriptors += "Genre: $valRaw"
                }
                "artist", "a" -> { artists += value; descriptors += "Artist: $valRaw" }
                "album", "al" -> { albums += value; descriptors += "Album: $valRaw" }
                "format", "fmt", "ext" -> { formats += value; descriptors += "Format: ${valRaw.uppercase()}" }
                "folder", "dir" -> { folders += value; descriptors += "Folder: $valRaw" }
                "status", "is", "has" -> when (value) {
                    "matched", "yt" -> {
                        if (isNeg) excludedStatuses += "matched" else statuses += "matched"
                        descriptors += if (isNeg) "Not matched" else "YT Matched"
                    }
                    "unmatched", "pending" -> {
                        if (isNeg) excludedStatuses += "unmatched" else statuses += "unmatched"
                        descriptors += if (isNeg) "Not unmatched" else "Unmatched"
                    }
                    "missing", "broken" -> {
                        if (isNeg) excludedStatuses += "missing" else statuses += "missing"
                        descriptors += if (isNeg) "Present on device" else "Missing on device"
                    }
                    "skipped" -> {
                        if (isNeg) excludedStatuses += "skipped" else statuses += "skipped"
                        descriptors += if (isNeg) "Not skipped" else "Skipped"
                    }
                    "lossless" -> { lossless = !isNeg; descriptors += if (isNeg) "Lossy only" else "Lossless audio" }
                    "art", "artwork", "cover" -> { hasArt = !isNeg; descriptors += if (isNeg) "No cover art" else "Has cover art" }
                    "noart", "nocover" -> { hasArt = isNeg; descriptors += if (isNeg) "Has cover art" else "No cover art" }
                    "played" -> { played = !isNeg; descriptors += if (isNeg) "Unplayed" else "Played" }
                    "unplayed" -> { played = isNeg; descriptors += if (isNeg) "Played" else "Unplayed" }
                }
                "year", "y" -> parseNumeric(value) { it.toIntOrNull()?.takeIf { n -> n in 1900..2100 }?.toDouble() }?.let {
                    yearFilter = it; descriptors += "Year: $valRaw"
                }
                "plays", "play", "p" -> parseNumeric(value) { it.toIntOrNull()?.takeIf { n -> n >= 0 }?.toDouble() }?.let {
                    playsFilter = it; descriptors += "Plays: $valRaw"
                }
                "duration", "dur", "len", "time" -> parseNumeric(value, ::parseDurationVal)?.let {
                    durationFilter = it; descriptors += "Duration: $valRaw"
                }
                else -> terms += body.lowercase()
            }
        }
        return ParsedSmartQuery(
            raw = raw,
            terms = terms,
            excludedTerms = excludedTerms,
            genres = genres,
            excludedGenres = excludedGenres,
            artists = artists,
            albums = albums,
            formats = formats,
            folders = folders,
            statuses = statuses,
            excludedStatuses = excludedStatuses,
            lossless = lossless,
            hasArt = hasArt,
            played = played,
            yearFilter = yearFilter,
            playsFilter = playsFilter,
            durationFilter = durationFilter,
            activeDescriptors = descriptors,
        )
    }

    private fun fuzzyMatch(haystack: String, needle: String): Int {
        if (haystack.isEmpty() || needle.isEmpty()) return 0
        if (haystack == needle) return 100
        if (haystack.startsWith(needle)) return 82
        if (haystack.contains(" $needle")) return 70
        if (haystack.contains(needle)) return 55

        if (needle.length in 2..6) {
            val words = haystack.split(Regex("[\\s\\-_/]+")).filter { it.isNotEmpty() }
            if (words.size >= needle.length) {
                val initials = words.map { it[0] }.joinToString("")
                if (initials.contains(needle)) return 42
            }
        }
        if (needle.length >= 4) {
            for (word in haystack.split(Regex("[^a-z0-9]+"))) {
                if (abs(word.length - needle.length) > 1) continue
                var diffs = 0
                var i = 0
                var j = 0
                while (i < word.length && j < needle.length) {
                    if (word[i] == needle[j]) { i++; j++ }
                    else {
                        diffs++
                        if (diffs > 1) break
                        when {
                            word.length > needle.length -> i++
                            needle.length > word.length -> j++
                            else -> { i++; j++ }
                        }
                    }
                }
                diffs += (word.length - i) + (needle.length - j)
                if (diffs <= 1) return 32
            }
        }
        return 0
    }

    fun evaluateTracks(
        tracks: List<LocalTrack>,
        rawQuery: String,
        playStats: Map<String, TrackPlayStats> = emptyMap(),
    ): Pair<ParsedSmartQuery, List<SmartTrackResult>> {
        val parsed = parseQuery(rawQuery)
        val hasFilters = parsed.terms.isNotEmpty() || parsed.excludedTerms.isNotEmpty() ||
            parsed.genres.isNotEmpty() || parsed.excludedGenres.isNotEmpty() ||
            parsed.artists.isNotEmpty() || parsed.albums.isNotEmpty() ||
            parsed.formats.isNotEmpty() || parsed.folders.isNotEmpty() ||
            parsed.statuses.isNotEmpty() || parsed.excludedStatuses.isNotEmpty() ||
            parsed.lossless != null || parsed.hasArt != null || parsed.played != null ||
            parsed.yearFilter != null || parsed.playsFilter != null || parsed.durationFilter != null

        if (!hasFilters) {
            return parsed to tracks.map { SmartTrackResult(it, inferTrackGenre(it).genre, 0, emptyList()) }
        }

        val results = mutableListOf<SmartTrackResult>()
        for (track in tracks) {
            val genre = inferTrackGenre(track).genre
            val genreLower = genre.lowercase()
            val rawGenre = track.genre.orEmpty().lowercase()
            val titleLower = track.title.lowercase()
            val artistLower = track.artist.lowercase()
            val albumLower = track.album.lowercase()
            val folderLower = track.folderName.lowercase()
            val fileLower = track.fileName.lowercase()
            val fmtUpper = track.format.uppercase()
            val fmtLower = fmtUpper.lowercase()
            val plays = playStats[track.id]?.playCount ?: track.playCount ?: 0

            if (parsed.genres.isNotEmpty() && parsed.genres.none { genreLower.contains(it) || rawGenre.contains(it) }) continue
            if (parsed.excludedGenres.isNotEmpty() && parsed.excludedGenres.any { genreLower.contains(it) || rawGenre.contains(it) }) continue
            if (parsed.artists.isNotEmpty() && !parsed.artists.all { artistLower.contains(it) }) continue
            if (parsed.albums.isNotEmpty() && !parsed.albums.all { albumLower.contains(it) }) continue
            if (parsed.formats.isNotEmpty() && parsed.formats.none { fmtLower == it || fmtLower.contains(it) }) continue
            if (parsed.folders.isNotEmpty() && !parsed.folders.all { folderLower.contains(it) }) continue

            fun checkStatus(st: String): Boolean = when (st) {
                "matched" -> !track.youtubeVideoId.isNullOrBlank()
                "unmatched" -> track.youtubeVideoId.isNullOrBlank() && track.matchStatus != MatchStatus.SKIPPED
                "missing" -> track.isMissingOnDevice
                else -> track.matchStatus == MatchStatus.SKIPPED
            }
            if (parsed.statuses.isNotEmpty() && !parsed.statuses.all(::checkStatus)) continue
            if (parsed.excludedStatuses.isNotEmpty() && parsed.excludedStatuses.any(::checkStatus)) continue

            if (parsed.lossless != null && (fmtUpper in LOSSLESS_FORMATS) != parsed.lossless) continue
            if (parsed.hasArt != null && !track.coverArtUrl.isNullOrBlank() != parsed.hasArt) continue
            if (parsed.played != null && (plays > 0) != parsed.played) continue
            if (parsed.yearFilter != null) {
                val yr = track.year.take(4).toDoubleOrNull() ?: continue
                if (!matchesNumeric(yr, parsed.yearFilter)) continue
            }
            if (parsed.playsFilter != null && !matchesNumeric(plays.toDouble(), parsed.playsFilter)) continue
            if (parsed.durationFilter != null && (track.duration <= 0.0 || !matchesNumeric(track.duration, parsed.durationFilter))) continue

            val fullText = "$titleLower $artistLower $albumLower $genreLower $rawGenre $folderLower $fileLower ${track.year} $fmtLower ${track.youtubeVideoId.orEmpty().lowercase()}"
            if (parsed.excludedTerms.any { fullText.contains(it) }) continue

            var totalScore = 10.0
            val matchedFields = mutableSetOf<String>()
            var allMatched = true
            for (term in parsed.terms) {
                val tScore = fuzzyMatch(titleLower, term) * 1.4
                val aScore = fuzzyMatch(artistLower, term) * 1.15
                val alScore = fuzzyMatch(albumLower, term) * 1.0
                val gScore = fuzzyMatch(genreLower, term) * 0.95
                val pScore = fuzzyMatch("$folderLower $fileLower", term) * 0.7
                val mScore = if (track.year == term || fmtLower == term || track.youtubeVideoId.equals(term, true)) 75.0 else 0.0
                val best = maxOf(tScore, aScore, alScore, gScore, pScore, mScore)
                if (best <= 0.0) { allMatched = false; break }
                totalScore += best
                when (best) {
                    tScore -> matchedFields += "title"
                    aScore -> matchedFields += "artist"
                    alScore -> matchedFields += "album"
                    gScore -> matchedFields += "genre"
                    mScore -> matchedFields += "metadata"
                    else -> matchedFields += "file"
                }
            }
            if (!allMatched) continue
            totalScore += min(12, plays * 2)
            if (!track.youtubeVideoId.isNullOrBlank()) totalScore += 3
            results += SmartTrackResult(track, genre, totalScore.roundToInt(), matchedFields.toList())
        }
        results.sortWith(compareByDescending<SmartTrackResult> { it.score }.thenByDescending { it.track.addedAt })
        return parsed to results
    }

    fun runGlobal(
        rawQuery: String,
        tracks: List<LocalTrack>,
        playlists: List<Playlist>,
        playStats: Map<String, TrackPlayStats> = emptyMap(),
    ): GlobalSmartSearchResults {
        val (parsed, trackResults) = evaluateTracks(tracks, rawQuery, playStats)
        val q = parsed.terms.joinToString(" ").trim()
        val matchedPlaylists = playlists
            .mapNotNull { pl ->
                val score = if (q.isEmpty()) 1 else maxOf(fuzzyMatch(pl.name.lowercase(), q), fuzzyMatch(pl.description.lowercase(), q))
                if (score > 0) pl to score else null
            }
            .sortedByDescending { it.second }
            .map { it.first }

        val albumSource = if (q.isNotEmpty() || parsed.activeDescriptors.isNotEmpty()) trackResults.map { it.track } else tracks
        val albums = albumSource
            .filter { it.album.isNotBlank() && !it.album.equals("Unknown Album", ignoreCase = true) }
            .groupBy { it.album.trim().lowercase() }
            .map { (key, list) ->
                val first = list.first()
                val score = if (q.isEmpty()) 10 else maxOf(fuzzyMatch(first.album.lowercase(), q), fuzzyMatch(first.artist.lowercase(), q))
                SmartAlbumResult(key, first.album, first.artist, first.year, list.firstNotNullOfOrNull { it.coverArtUrl }, list.map { it.id }, score)
            }
            .sortedWith(compareByDescending<SmartAlbumResult> { it.score }.thenByDescending { it.trackIds.size })

        val genres = tracks.groupBy { inferTrackGenre(it).genre }
            .map { (g, list) ->
                val score = if (q.isEmpty()) 10 else fuzzyMatch(g.lowercase(), q)
                SmartGenreResult(g, list.size, list.map { it.id }, score)
            }
            .filter { if (q.isNotEmpty()) it.score > 0 else it.genre != "Unclassified" }
            .sortedWith(compareByDescending<SmartGenreResult> { it.score }.thenByDescending { it.count })

        return GlobalSmartSearchResults(parsed, trackResults, matchedPlaylists, albums, genres)
    }
}
