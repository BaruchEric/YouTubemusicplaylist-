package com.cratesync.core

import com.cratesync.platform.normalizeUnicodeNfc

/**
 * Folds file names to NFC lowercase so decomposed macOS paths match composed Drive/Windows/Android paths.
 */
fun foldFileName(name: String): String = normalizeUnicodeNfc(name).lowercase()

fun nameSizeKey(name: String, size: Long): String = "${foldFileName(name)}::$size"

fun pathSizeKey(relativePath: String, size: Long): String = "${foldFileName(relativePath)}::$size"

val SUPPORTED_AUDIO_EXTENSIONS = setOf(
    "mp3", "flac", "m4a", "mp4", "aac", "wav", "ogg", "oga", "opus", "aiff", "aif", "aifc", "alac", "wma", "webm"
)

fun isSupportedAudioFileName(fileName: String, mimeType: String? = null): Boolean {
    if (mimeType != null && mimeType.startsWith("audio/", ignoreCase = true)) return true
    val dot = fileName.lastIndexOf('.')
    if (dot < 0 || dot == fileName.lastIndex) return false
    val ext = fileName.substring(dot + 1).lowercase()
    return ext in SUPPORTED_AUDIO_EXTENSIONS
}

fun extractAudioFormat(fileName: String): String {
    val dot = fileName.lastIndexOf('.')
    if (dot < 0 || dot == fileName.lastIndex) return "AUDIO"
    return fileName.substring(dot + 1).uppercase()
}
