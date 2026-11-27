package com.cratesync.core

import com.cratesync.model.LocalTrack

val CANONICAL_GENRES = listOf(
    "Electronic",
    "Hip-Hop / Rap",
    "Pop",
    "Rock",
    "Indie / Alternative",
    "R&B / Soul",
    "Funk / Disco",
    "Jazz",
    "Blues",
    "Classical",
    "Metal",
    "Punk / Hardcore",
    "Country / Folk",
    "Latin / Afrobeats",
    "Reggae / Dub",
    "Ambient / Lo-Fi",
    "World / Global",
    "Soundtrack / Score",
    "Acoustic / Instrumental",
    "Podcast / Spoken",
)

data class InferredGenreResult(
    val genre: String,
    val fromTag: Boolean,
)

private val GENRE_RULES: List<Pair<String, List<String>>> = listOf(
    "Electronic" to listOf("electronic", "edm", "house", "techno", "trance", "dnb", "drum and bass", "dubstep", "synthwave", "electro", "dance", "club", "idm", "ukg", "garage"),
    "Hip-Hop / Rap" to listOf("hip-hop", "hip hop", "hiphop", "rap", "trap", "boom bap", "drill", "grime"),
    "Pop" to listOf("pop", "synthpop", "electropop", "k-pop", "j-pop", "top 40"),
    "Rock" to listOf("rock", "classic rock", "hard rock", "grunge", "psychedelic", "prog"),
    "Indie / Alternative" to listOf("indie", "alternative", "alt-rock", "shoegaze", "post-punk", "britpop"),
    "R&B / Soul" to listOf("r&b", "rnb", "soul", "neo-soul", "motown", "gospel"),
    "Funk / Disco" to listOf("funk", "disco", "boogie", "nu-disco"),
    "Jazz" to listOf("jazz", "bebop", "swing", "fusion", "bossa nova"),
    "Blues" to listOf("blues", "delta blues", "rhythm & blues"),
    "Classical" to listOf("classical", "orchestra", "symphony", "baroque", "chamber", "opera", "piano sonata"),
    "Metal" to listOf("metal", "heavy metal", "thrash", "death metal", "black metal", "doom"),
    "Punk / Hardcore" to listOf("punk", "hardcore", "emo", "ska"),
    "Country / Folk" to listOf("country", "folk", "americana", "bluegrass", "singer-songwriter"),
    "Latin / Afrobeats" to listOf("latin", "reggaeton", "salsa", "bachata", "afrobeats", "afrobeat", "amapiano", "cumbia"),
    "Reggae / Dub" to listOf("reggae", "dub", "dancehall", "roots"),
    "Ambient / Lo-Fi" to listOf("ambient", "lo-fi", "lofi", "chillout", "chillhop", "downtempo", "new age"),
    "World / Global" to listOf("world", "global", "celtic", "flamenco", "bollywood", "arabic"),
    "Soundtrack / Score" to listOf("soundtrack", "ost", "score", "film", "cinema", "game"),
    "Acoustic / Instrumental" to listOf("acoustic", "instrumental", "unplugged"),
    "Podcast / Spoken" to listOf("podcast", "spoken", "audiobook", "comedy", "interview"),
)

private val ID3_V1_GENRES = listOf(
    "Blues", "Rock", "Country / Folk", "Electronic", "Funk / Disco", "Funk / Disco", "Rock",
    "Hip-Hop / Rap", "Jazz", "Metal", "Ambient / Lo-Fi", "Pop", "Pop", "Pop", "R&B / Soul",
    "Hip-Hop / Rap", "Reggae / Dub", "Rock", "Electronic", "Electronic", "Indie / Alternative",
    "Punk / Hardcore", "Metal", "Soundtrack / Score", "Electronic", "Electronic", "Ambient / Lo-Fi",
    "World / Global", "Soundtrack / Score", "Pop", "Jazz", "Electronic", "Classical", "Electronic",
)

fun mapId3v1GenreIndex(index: Int): String? = ID3_V1_GENRES.getOrNull(index)

fun normalizeCanonicalGenre(raw: String?): String? {
    val cleaned = raw?.trim().orEmpty()
    if (cleaned.isEmpty()) return null
    val lower = cleaned.lowercase()
    if (lower in setOf("other", "unknown", "misc", "general", "none", "unclassified", "untagged")) return null

    // Numeric ID3v2 "(17)" style
    Regex("^\\(?(\\d{1,3})\\)?$").matchEntire(cleaned)?.let { m ->
        val idx = m.groupValues[1].toIntOrNull()
        if (idx != null) return mapId3v1GenreIndex(idx)
    }

    for (canonical in CANONICAL_GENRES) {
        if (canonical.equals(cleaned, ignoreCase = true)) return canonical
    }
    for ((canonical, keywords) in GENRE_RULES) {
        if (keywords.any { kw -> lower.contains(kw) }) return canonical
    }
    return cleaned
}

fun inferTrackGenre(track: LocalTrack): InferredGenreResult {
    val fromTag = normalizeCanonicalGenre(track.genre)
    if (fromTag != null) return InferredGenreResult(fromTag, fromTag = true)

    val context = "${track.folderName} ${track.relativePath} ${track.album} ${track.title}".lowercase()
    for ((canonical, keywords) in GENRE_RULES) {
        if (keywords.any { kw -> context.contains(kw) }) {
            return InferredGenreResult(canonical, fromTag = false)
        }
    }
    return InferredGenreResult("Unclassified", fromTag = false)
}
