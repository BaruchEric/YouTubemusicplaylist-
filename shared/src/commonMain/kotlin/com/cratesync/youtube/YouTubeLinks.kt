package com.cratesync.youtube

object YouTubeLinks {
    private val VIDEO_ID_REGEX = Regex("""^[A-Za-z0-9_-]{11}$""")
    private val PLAYLIST_ID_REGEX = Regex("""^[A-Za-z0-9_-]{2,}$""")

    fun extractVideoId(input: String): String? {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return null
        if (VIDEO_ID_REGEX.matches(trimmed)) return trimmed

        Regex("""[?&]v=([A-Za-z0-9_-]{11})""").find(trimmed)?.let { return it.groupValues[1] }
        Regex("""youtu\.be/([A-Za-z0-9_-]{11})""").find(trimmed)?.let { return it.groupValues[1] }
        Regex("""youtube\.com/(?:embed|shorts|live)/([A-Za-z0-9_-]{11})""").find(trimmed)?.let { return it.groupValues[1] }
        return null
    }

    fun extractPlaylistId(input: String): String? {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return null
        Regex("""[?&]list=([A-Za-z0-9_-]{2,})""").find(trimmed)?.let { return it.groupValues[1] }
        if (PLAYLIST_ID_REGEX.matches(trimmed) && Regex("""^(?:PL|OLAK5uy_|UU|FL|RD|LL$|LM$)""").containsMatchIn(trimmed)) {
            return trimmed
        }
        return null
    }

    fun buildYouTubeMusicWatchUrl(videoId: String): String =
        "https://music.youtube.com/watch?v=$videoId"

    fun buildYouTubeMusicPlaylistUrl(playlistId: String): String =
        "https://music.youtube.com/playlist?list=$playlistId"

    fun buildYouTubeMusicSearchUrl(query: String): String =
        "https://music.youtube.com/search?q=${query.trim().replace(" ", "+")}"
}
