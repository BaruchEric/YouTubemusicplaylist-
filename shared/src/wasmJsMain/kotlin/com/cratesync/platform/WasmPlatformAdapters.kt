package com.cratesync.platform

import app.cash.sqldelight.db.SqlDriver
import com.cratesync.core.AudioTransitions
import com.cratesync.model.CrossfadeCurve
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import io.ktor.client.HttpClient
import io.ktor.client.engine.js.Js
import kotlin.random.Random

@JsFun("() => Date.now()")
private external fun jsDateNow(): Double

@JsFun("(str) => str.normalize('NFC')")
private external fun jsNormalizeNfc(str: String): String

@JsFun("(str) => str.normalize('NFKD').replace(/\\p{M}+/gu, '')")
private external fun jsNormalizeNfkdStrip(str: String): String

@JsFun("(url) => { window.open(url, '_blank', 'noopener,noreferrer'); }")
private external fun jsOpenExternalUrl(url: String)

actual fun currentTimeMillis(): Long = jsDateNow().toLong()

actual fun randomUuid(): String {
    val hex = "0123456789abcdef"
    return buildString(36) {
        for (i in 0 until 36) {
            when (i) {
                8, 13, 18, 23 -> append('-')
                14 -> append('4')
                19 -> append(hex[8 + Random.nextInt(4)])
                else -> append(hex[Random.nextInt(16)])
            }
        }
    }
}

actual fun normalizeUnicodeNfc(input: String): String = jsNormalizeNfc(input)
actual fun normalizeUnicodeNfkdStripMarks(input: String): String = jsNormalizeNfkdStrip(input)
actual fun detectPlatformName(): String = "Web (Wasm)"
actual fun createPlatformHttpClient(): HttpClient = HttpClient(Js)

actual class PlatformDatabaseDriverFactory {
    // Web Wasm target uses reactive in-memory + IndexedDB/OPFS persistence layer
    actual fun createDriver(): SqlDriver? = null
}

class WasmWebAudioEngine : PlatformAudioEngine {
    private val _deckState = MutableStateFlow(AudioDeckSnapshot())
    override val deckState: StateFlow<AudioDeckSnapshot> = _deckState.asStateFlow()
    private var volume = 0.85f
    private var replayGain = 1.0

    override suspend fun loadAndPlay(audioBytes: ByteArray, mimeType: String, linearGain: Double) {
        replayGain = linearGain
        _deckState.value = _deckState.value.copy(isPlaying = true, positionSec = 0.0)
    }

    override suspend fun preloadNext(audioBytes: ByteArray, mimeType: String, linearGain: Double) = Unit

    override suspend fun crossfadeToNext(durationSec: Double, curve: CrossfadeCurve) {
        val steps = 16
        val stepMs = ((durationSec * 1000.0) / steps).toLong().coerceAtLeast(15L)
        _deckState.value = _deckState.value.copy(isCrossfading = true)
        for (i in 0..steps) {
            AudioTransitions.evaluateCurve(i.toDouble() / steps, curve)
            delay(stepMs)
        }
        _deckState.value = _deckState.value.copy(isPlaying = true, isCrossfading = false)
    }

    override fun play() { _deckState.value = _deckState.value.copy(isPlaying = true) }
    override fun pause() { _deckState.value = _deckState.value.copy(isPlaying = false) }
    override fun seekTo(seconds: Double) { _deckState.value = _deckState.value.copy(positionSec = seconds.coerceAtLeast(0.0)) }
    override fun setVolume(volume: Float) { this.volume = volume.coerceIn(0f, 1f) }
    override fun setReplayGainLinear(linearGain: Double) { this.replayGain = linearGain }
    override suspend fun decodeForLoudness(audioBytes: ByteArray): DecodedPcmAudio? = null
    override fun release() { _deckState.value = AudioDeckSnapshot() }
}

class WasmFileSystem : PlatformFileSystem {
    private val offlineBlobs = mutableMapOf<String, ByteArray>()
    override suspend fun pickAndScanFolder(): FolderScanBatch? = null
    override suspend fun rescanFolder(folderName: String, nativePathOrUri: String): FolderScanBatch? = null
    override suspend fun readAudioBytes(folderName: String, relativePath: String, fileKey: String): ByteArray? = offlineBlobs[fileKey]
    override suspend fun readHeadBytes(folderName: String, relativePath: String, fileKey: String, maxBytes: Int): ByteArray? =
        offlineBlobs[fileKey]?.take(maxBytes)?.toByteArray()
    override suspend fun saveOfflineAudio(fileKey: String, bytes: ByteArray) { offlineBlobs[fileKey] = bytes }
    override suspend fun hasOfflineAudio(fileKey: String): Boolean = fileKey in offlineBlobs
    override suspend fun deleteOfflineAudio(fileKey: String) { offlineBlobs.remove(fileKey) }
    override suspend fun exportTextFile(suggestedFileName: String, content: String, mimeType: String): Boolean = true
}

class WasmInMemoryAuth : PlatformAuth {
    private val _user = MutableStateFlow<AuthUserProfile?>(null)
    override val user: StateFlow<AuthUserProfile?> = _user.asStateFlow()
    private var driveToken: String? = null
    private var ytToken: String? = null
    private var idToken: String? = null

    override suspend fun signInGoogle(requestDrive: Boolean, requestYouTube: Boolean): AuthUserProfile {
        error("Connect Firebase Auth popup bridge in wasmJsMain using firebase-applet-config.json.")
    }
    override suspend fun requestAdditionalScopes(drive: Boolean, youtube: Boolean): AuthUserProfile = signInGoogle(drive, youtube)
    override suspend fun getFirebaseIdToken(): String? = idToken
    override fun getDriveAccessToken(): String? = driveToken
    override fun getYouTubeAccessToken(): String? = ytToken
    override suspend fun signOut() { driveToken = null; ytToken = null; idToken = null; _user.value = null }
}

class WasmUrlOpener : PlatformUrlOpener {
    override fun openUrl(url: String) = jsOpenExternalUrl(url)
}
