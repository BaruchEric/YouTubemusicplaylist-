package com.cratesync.platform

expect fun currentTimeMillis(): Long

expect fun randomUuid(): String

/**
 * Normalizes text to Unicode NFC so macOS NFD filenames match Google Drive / Linux / Android NFC names.
 */
expect fun normalizeUnicodeNfc(input: String): String

/**
 * Normalizes text to Unicode NFKD and strips combining diacritical marks for deterministic search matching.
 */
expect fun normalizeUnicodeNfkdStripMarks(input: String): String

expect fun detectPlatformName(): String
