package com.cratesync.youtube

import com.cratesync.core.ImportedTrackSeed
import com.cratesync.model.LocalTrack
import com.cratesync.model.MatchStatus
import com.cratesync.model.Playlist
import com.cratesync.model.YouTubeCheckStamp
import com.cratesync.platform.normalizeUnicodeNfkdStripMarks
import kotlinx.coroutines.delay

enum class MatchConfidence { EXACT, LIKELY }

data class MatchProposal(
    val trackId: String,
    val candidate: YouTubeVideoSummary,
    val confidence: MatchConfidence,
)

data class BulkSearchOutcome(
    val proposals: List<MatchProposal>,
    val searchedIds: List<String>,
    val stoppedMessage: String? = null,
)

/**
 * Deterministic YouTube bulk-matching engine with version-word safety (live/remix/karaoke/etc.),
 * Topic-channel prioritization, playlist lookup normalization (LM -> LL), and 30-day search memory.
 */
object YouTubeBulkMatch {
    const val YOUTUBE_SEARCH_COST_UNITS = 100
    const val SEARCH_MEMORY_TTL_MS = 30L * 24 * 60 * 60 * 1000
    private const val CLOSE_TITLE_SCORE = 0.85
    private const val MIN_COMPACT_ARTIST_LENGTH = 6
    private const val MIN_LEAD_ARTIST_LENGTH = 6
    private const val MAX_FUZZY_CANDIDATES = 200

    private val UNKNOWN_ARTISTS = setOf("", "unknown artist", "unknown", "various artists", "various", "va")
    private val VERSION_WORDS = listOf(
        "live", "remix", "acoustic", "instrumental", "karaoke",
        "cover", "demo", "unplugged", "extended", "dub", "alternate"
    )
    private val RERECORDED = Regex("""(?:^| )re ?record(?:ed|ing)(?: |$)""")
    private val BRACKETED = Regex("""[({\[]+([^)\]}]*)[)\]}]+""")
    private val FEATURED = Regex("""\s+(?:feat\.?|ft\.?|featuring)\s.*$""", RegexOption.IGNORE_CASE)
    private val DASH = Regex("""\s+[-–—]\s+""")
    private val ARTIST_SEP = Regex("""\s*(?:,|;|&|/|\s+and\s+|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+|\s+with\s+|\s+x\s+|\s+vs\.?\s+)\s*""", RegexOption.IGNORE_CASE)
    private val LEADING_NUMBER = Regex("""^\d{1,3}(?:\s*[-._)]\s*|\s+)(?=\S)""")
    private val RELEASE_NOTE = Regex(
        """^(?:(?:\d{4} )?(?:digital(?:ly)? )?remaster(?:ed)?(?: \d{4})?(?: version)?|(?:single|album|radio|original|mono|stereo|explicit|clean)(?: (?:version|edit|mix))?|bonus track|live(?: .*)?)$"""
    )

    fun normalizeForMatch(text: String): String =
        normalizeUnicodeNfkdStripMarks(text)
            .lowercase()
            .replace("&", " and ")
            .replace(Regex("""['’‘`´]"""), "")
            .replace(Regex("""[^\p{L}\p{N}]+"""), " ")
            .trim()

    private fun compact(normalized: String): String = normalized.replace(" ", "")

    private fun versionWordsIn(text: String): List<String> {
        val norm = normalizeForMatch(text)
        val words = norm.split(' ').toSet()
        val found = VERSION_WORDS.filter { it in words }.toMutableList()
        if (RERECORDED.containsMatchIn(norm)) found += "rerecorded"
        return found
    }

    private fun withKaraoke(versions: List<String>, vararg texts: String): List<String> {
        val says = texts.any { "karaoke" in normalizeForMatch(it).split(' ') }
        return if (says) (versions + "karaoke").distinct().sorted() else versions.distinct().sorted()
    }

    private data class TitleParts(val parts: List<String>, val versions: List<String>)

    private fun titleParts(raw: String): TitleParts {
        val versions = mutableSetOf<String>()
        val unbracketed = BRACKETED.replace(raw) { m ->
            versions += versionWordsIn(m.groupValues[1])
            " "
        }
        val parts = unbracketed.replace(FEATURED, "").split(DASH).map { it.trim() }.filter { it.isNotEmpty() }.toMutableList()
        while (parts.size > 1) {
            val last = normalizeForMatch(parts.last())
            if (!RELEASE_NOTE.matches(last)) break
            versions += versionWordsIn(last)
            parts.removeAt(parts.lastIndex)
        }
        if (parts.isEmpty()) {
            val bare = raw.replace(Regex("""[()\[\]{}]"""), " ").trim()
            if (bare.isNotEmpty()) parts += bare
        }
        return TitleParts(parts, versions.sorted())
    }

    private data class SongForm(
        val titles: List<String>,
        val artists: List<String>,
        val shortArtists: List<String>,
        val versions: List<String>,
        val albumVersions: List<String>,
    )

    private fun artistNames(artist: String): List<String> {
        if (artist.trim().lowercase() in UNKNOWN_ARTISTS) return emptyList()
        val out = linkedSetOf<String>()
        val whole = normalizeForMatch(artist).removePrefix("the ")
        if (whole.isNotEmpty()) out += whole
        val parts = artist.split(ARTIST_SEP).map { it.trim() }.filter { it.isNotEmpty() }
        if (parts.size > 1) {
            val lead = normalizeForMatch(parts.first()).removePrefix("the ")
            if (' ' in lead || lead.length >= MIN_LEAD_ARTIST_LENGTH) out += lead
        }
        return out.toList()
    }

    private fun songForm(title: String, artist: String, album: String = ""): SongForm {
        val (parts, bracketed) = titleParts(title)
        val versions = withKaraoke(bracketed, title)
        val artists = artistNames(artist)
        val titles = linkedSetOf(normalizeForMatch(parts.joinToString(" ")))
        val numberless = title.replace(LEADING_NUMBER, "")
        if (numberless != title && Regex("""\p{L}""").containsMatchIn(numberless)) {
            titles += normalizeForMatch(titleParts(numberless).parts.joinToString(" "))
        }
        if (artists.isEmpty() && parts.size > 1) {
            titles += normalizeForMatch(parts.drop(1).joinToString(" "))
        }
        titles.remove("")
        val shortArtists = artists.mapNotNull { name ->
            val words = name.split(' ')
            if (words.size == 3) "${words[0]} ${words[2]}" else null
        }
        val albumVersions = (versions + versionWordsIn(album)).distinct().sorted()
        return SongForm(titles.toList(), artists, shortArtists, versions, albumVersions)
    }

    private data class Reading(val title: String, val artistText: String)
    private data class CandidateForm(val readings: List<Reading>, val versions: List<String>, val isTopicChannel: Boolean)

    private fun candidateForm(c: YouTubeVideoSummary): CandidateForm {
        val (parts, bracketed) = titleParts(c.title)
        val versions = withKaraoke(bracketed, c.title, c.channel)
        val channel = normalizeForMatch(c.channel)
        val whole = normalizeForMatch(parts.joinToString(" "))
        val readings = mutableListOf(Reading(whole, channel))
        if (parts.size > 1) {
            val left = normalizeForMatch(parts.first())
            val right = normalizeForMatch(parts.drop(1).joinToString(" "))
            readings += Reading(right, "$left $channel")
            readings += Reading(left, right)
        }
        return CandidateForm(readings.filter { it.title.isNotEmpty() }, versions, channel.endsWith(" topic"))
    }

    private fun namesArtist(artistText: String, artists: List<String>): Boolean =
        artists.any { artist ->
            if (" $artistText ".contains(" $artist ")) return@any true
            val squeezed = compact(artist)
            squeezed.length >= MIN_COMPACT_ARTIST_LENGTH && compact(artistText).contains(squeezed)
        }

    private fun sharedWords(a: String, b: String): Double {
        val left = a.split(' ')
        val right = b.split(' ')
        val pool = mutableMapOf<String, Int>()
        for (w in left) pool[w] = (pool[w] ?: 0) + 1
        var shared = 0
        for (w in right) {
            val count = pool[w] ?: 0
            if (count > 0) { shared++; pool[w] = count - 1 }
        }
        return (2.0 * shared) / (left.size + right.size)
    }

    private fun isCloseTitle(a: String, b: String): Boolean =
        sharedWords(a, b) >= CLOSE_TITLE_SCORE || a.removePrefix("the ") == b.removePrefix("the ")

    private fun scoreForms(song: SongForm, cand: CandidateForm): MatchConfidence? {
        if (song.versions != cand.versions && song.albumVersions != cand.versions) return null
        var best: MatchConfidence? = null
        for (r in cand.readings) {
            val exactTitle = r.title in song.titles
            val closeTitle = !exactTitle && song.titles.any { isCloseTitle(it, r.title) }
            if (!exactTitle && !closeTitle) continue
            if (song.artists.isEmpty()) {
                if (exactTitle) best = MatchConfidence.LIKELY
                continue
            }
            val named = namesArtist(r.artistText, song.artists)
            if (!named && !namesArtist(r.artistText, song.shortArtists)) continue
            if (exactTitle && named) return MatchConfidence.EXACT
            best = MatchConfidence.LIKELY
        }
        return best
    }

    fun scoreCandidate(title: String, artist: String, album: String, candidate: YouTubeVideoSummary): MatchConfidence? =
        scoreForms(songForm(title, artist, album), candidateForm(candidate))

    private data class Scored(
        val candidate: YouTubeVideoSummary,
        val confidence: MatchConfidence,
        val fitsAlbum: Boolean,
        val isTopic: Boolean,
        val index: Int,
    )

    private fun isBetter(a: Scored, b: Scored?): Boolean {
        if (b == null) return true
        if (a.confidence != b.confidence) return a.confidence == MatchConfidence.EXACT
        if (a.fitsAlbum != b.fitsAlbum) return a.fitsAlbum
        if (a.isTopic != b.isTopic) return a.isTopic
        return a.index < b.index
    }

    fun songsToMatch(tracks: List<LocalTrack>): List<LocalTrack> =
        tracks.filter { it.youtubeVideoId.isNullOrBlank() && it.matchStatus != MatchStatus.SKIPPED }

    fun pickSearchResult(track: LocalTrack, results: List<YouTubeVideoSummary>): MatchProposal? {
        val song = songForm(track.title, track.artist, track.album)
        var best: Scored? = null
        results.forEachIndexed { idx, cand ->
            val form = candidateForm(cand)
            val conf = scoreForms(song, form) ?: return@forEachIndexed
            val s = Scored(cand, conf, song.albumVersions == form.versions, form.isTopicChannel, idx)
            if (isBetter(s, best)) best = s
        }
        return best?.let { MatchProposal(track.id, it.candidate, it.confidence) }
    }

    fun planBulkMatch(tracks: List<LocalTrack>, candidates: List<YouTubeVideoSummary>): List<MatchProposal> {
        val forms = candidates.map(::candidateForm)
        val byTitle = mutableMapOf<String, MutableList<Int>>()
        val byWord = mutableMapOf<String, MutableList<Int>>()
        forms.forEachIndexed { idx, form ->
            for (r in form.readings) {
                byTitle.getOrPut(r.title) { mutableListOf() }.add(idx)
                for (w in r.title.split(' ')) {
                    if (w.length >= 3) byWord.getOrPut(w) { mutableListOf() }.add(idx)
                }
            }
        }
        return buildList {
            for (track in songsToMatch(tracks)) {
                val song = songForm(track.title, track.artist, track.album)
                val indexes = linkedSetOf<Int>()
                for (t in song.titles) indexes += byTitle[t].orEmpty()
                if (indexes.isEmpty()) {
                    outer@ for (t in song.titles) {
                        for (w in t.split(' ')) {
                            for (idx in byWord[w].orEmpty()) {
                                if (indexes.size >= MAX_FUZZY_CANDIDATES) break@outer
                                indexes += idx
                            }
                        }
                    }
                }
                var best: Scored? = null
                for (idx in indexes) {
                    val form = forms[idx]
                    val cand = candidates[idx]
                    val conf = scoreForms(song, form) ?: continue
                    val s = Scored(cand, conf, song.albumVersions == form.versions, form.isTopicChannel, idx)
                    if (isBetter(s, best)) best = s
                }
                if (best != null) add(MatchProposal(track.id, best.candidate, best.confidence))
            }
        }
    }

    fun playlistIdForLookup(input: String): String? {
        val id = YouTubeLinks.extractPlaylistId(input) ?: return null
        return if (id == "LM") "LL" else id
    }

    fun candidatesFromSeeds(seeds: List<ImportedTrackSeed>): List<YouTubeVideoSummary> =
        seeds.mapNotNull { seed ->
            val vid = seed.youtubeVideoId ?: return@mapNotNull null
            val title = seed.title.trim()
            if (title.isEmpty()) return@mapNotNull null
            val artist = if (seed.artist.trim().lowercase() in UNKNOWN_ARTISTS) "" else seed.artist.trim()
            YouTubeVideoSummary(vid, if (artist.isNotEmpty()) "$artist - $title" else title, "")
        }

    fun searchQueryFor(track: LocalTrack): String {
        val base = track.fileName.substringBeforeLast('.').trim()
        val title = if (track.title.trim() == base) track.title.replace(LEADING_NUMBER, "") else track.title
        val artist = if (track.artist.trim().lowercase() in UNKNOWN_ARTISTS) "" else track.artist.trim()
        return "$artist ${title.trim()}".trim()
    }

    fun orderForSearch(tracks: List<LocalTrack>, playlists: List<Playlist>): List<LocalTrack> {
        val byId = tracks.associateBy { it.id }
        val listed = mutableListOf<LocalTrack>()
        val taken = mutableSetOf<String>()
        for (pl in playlists) {
            for (id in pl.trackIds) {
                val t = byId[id] ?: continue
                if (taken.add(t.id)) listed += t
            }
        }
        val rest = tracks.filter { it.id !in taken }
        fun taggedFirst(list: List<LocalTrack>): List<LocalTrack> {
            val (withArtist, without) = list.partition { it.artist.trim().lowercase() !in UNKNOWN_ARTISTS }
            return withArtist + without
        }
        return taggedFirst(listed) + taggedFirst(rest)
    }

    fun filterNotRecentlySearched(
        tracks: List<LocalTrack>,
        searchMemory: Map<String, Long>,
        nowMs: Long,
    ): List<LocalTrack> = tracks.filter { t ->
        val searchedAt = searchMemory[t.id] ?: return@filter true
        nowMs - searchedAt >= SEARCH_MEMORY_TTL_MS
    }

    suspend fun searchForMatches(
        api: YouTubeApi,
        tracks: List<LocalTrack>,
        onProgress: (done: Int, total: Int, found: Int) -> Unit = { _, _, _ -> },
    ): BulkSearchOutcome {
        val proposals = mutableListOf<MatchProposal>()
        val searched = mutableListOf<String>()
        for (track in tracks) {
            val query = searchQueryFor(track)
            val results = try {
                api.searchVideos(query)
            } catch (e: YouTubeApiException) {
                if (e.failure != YouTubeFailure.BUSY) {
                    return BulkSearchOutcome(proposals, searched, e.message)
                }
                delay(2000L)
                try {
                    api.searchVideos(query)
                } catch (e2: YouTubeApiException) {
                    return BulkSearchOutcome(proposals, searched, e2.message)
                }
            }
            searched += track.id
            pickSearchResult(track, results)?.let { proposals += it }
            onProgress(searched.size, tracks.size, proposals.size)
        }
        return BulkSearchOutcome(proposals, searched, null)
    }

    fun applyMatches(
        tracks: List<LocalTrack>,
        proposals: List<MatchProposal>,
        checkedAt: Long? = null,
    ): Pair<List<LocalTrack>, Int> {
        val byTrack = proposals.associate { it.trackId to it.candidate.videoId }
        var applied = 0
        val next = tracks.map { track ->
            val vid = byTrack[track.id]
            if (vid.isNullOrBlank() || !track.youtubeVideoId.isNullOrBlank()) return@map track
            applied++
            track.copy(
                youtubeVideoId = vid,
                matchStatus = MatchStatus.MATCHED,
                youtubeChecked = checkedAt?.let { YouTubeCheckStamp(vid, it) } ?: track.youtubeChecked,
            )
        }
        return next to applied
    }
}
