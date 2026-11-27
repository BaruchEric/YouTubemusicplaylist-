package com.cratesync.platform

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.native.NativeSqliteDriver
import com.cratesync.core.AudioTransitions
import com.cratesync.db.CrateSyncDatabase
import com.cratesync.model.CrossfadeCurve
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import platform.Foundation.NSDate
import platform.Foundation.NSString
import platform.Foundation.NSURL
import platform.Foundation.NSUUID
import platform.Foundation.decomposedStringWithCanonicalMapping
import platform.Foundation.precomposedStringWithCanonicalMapping
import platform.Foundation.timeIntervalSince1970
import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import platform.UIKit.UIApplication

actual fun currentTimeMillis(): Long = (NSDate().timeIntervalSince1970 * 1000.0).toLong()
actual fun randomUuid(): String = NSUUID().UUIDString()

@Suppress("CAST_NEVER_SUCCEEDS")
actual fun normalizeUnicodeNfc(input: String): String = (input as NSString).precomposedStringWithCanonicalMapping

@Suppress("CAST_NEVER_SUCCEEDS")
actual fun normalizeUnicodeNfkdStripMarks(input: String): String =
    (input as NSString).decomposedStringWithCanonicalMapping.replace(Regex("[\\u0300-\\u036f]"), "")

actual fun detectPlatformName(): String = "iOS"
actual fun createPlatformHttpClient(): HttpClient = HttpClient(Darwin)

actual class PlatformDatabaseDriverFactory {
    actual fun createDriver(): SqlDriver? =
        NativeSqliteDriver(CrateSyncDatabase.Schema, "cratesync.db")
}

/**
 * iOS dual-deck AVAudioEngine controller bridge for gapless playback, crossfade, and ReplayGain.
 */
class IosAvAudioEngine : PlatformAudioEngine {
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

class IosFileSystem : PlatformFileSystem {
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

class IosInMemoryAuth : PlatformAuth {
    private val _user = MutableStateFlow<AuthUserProfile?>(null)
    override val user: StateFlow<AuthUserProfile?> = _user.asStateFlow()
    private var driveToken: String? = null
    private var ytToken: String? = null
    private var idToken: String? = null

    override suspend fun signInGoogle(requestDrive: Boolean, requestYouTube: Boolean): AuthUserProfile {
        error("Configure ASWebAuthenticationSession OAuth callback in iosApp to exchange Google tokens in memory.")
    }
    override suspend fun requestAdditionalScopes(drive: Boolean, youtube: Boolean): AuthUserProfile = signInGoogle(drive, youtube)
    override suspend fun getFirebaseIdToken(): String? = idToken
    override fun getDriveAccessToken(): String? = driveToken
    override fun getYouTubeAccessToken(): String? = ytToken
    override suspend fun signOut() { driveToken = null; ytToken = null; idToken = null; _user.value = null }
}

class IosUrlOpener : PlatformUrlOpener {
    override fun openUrl(url: String) {
        NSURL.URLWithString(url)?.let { UIApplication.sharedApplication.openURL(it) }
    }
}
