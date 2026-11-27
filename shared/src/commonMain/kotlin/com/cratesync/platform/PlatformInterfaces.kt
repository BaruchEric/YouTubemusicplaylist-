package com.cratesync.platform

import app.cash.sqldelight.db.SqlDriver
import com.cratesync.model.CrossfadeCurve
import com.cratesync.model.ScanErrorEntry
import io.ktor.client.HttpClient
import kotlinx.coroutines.flow.StateFlow

data class AudioDeckSnapshot(
    val isPlaying: Boolean = false,
    val positionSec: Double = 0.0,
    val durationSec: Double = 0.0,
    val isCrossfading: Boolean = false,
)

data class DecodedPcmAudio(
    val channels: List<FloatArray>,
    val sampleRate: Int,
)

/**
 * Dual-deck crossfade and ReplayGain audio engine implemented natively on Android (Media3),
 * iOS (AVAudioEngine), Desktop (JVM Audio), and Web (Web Audio API).
 */
interface PlatformAudioEngine {
    val deckState: StateFlow<AudioDeckSnapshot>
    suspend fun loadAndPlay(audioBytes: ByteArray, mimeType: String, linearGain: Double)
    suspend fun preloadNext(audioBytes: ByteArray, mimeType: String, linearGain: Double)
    suspend fun crossfadeToNext(durationSec: Double, curve: CrossfadeCurve)
    fun play()
    fun pause()
    fun seekTo(seconds: Double)
    fun setVolume(volume: Float)
    fun setReplayGainLinear(linearGain: Double)
    suspend fun decodeForLoudness(audioBytes: ByteArray): DecodedPcmAudio?
    fun release()
}

data class ScannedPlatformFile(
    val name: String,
    val relativePath: String,
    val size: Long,
    val headBytes: ByteArray?,
    val tailBytes: ByteArray?,
)

data class FolderScanBatch(
    val folderName: String,
    val nativePathOrUri: String,
    val totalFilesEncountered: Int,
    val skippedNonAudioCount: Int,
    val audioFiles: List<ScannedPlatformFile>,
    val errors: List<ScanErrorEntry>,
)

/**
 * Zero-copy multi-folder file system bridge with path traversal guards and offline binary cache
 * reserved strictly for Google Drive downloads or unmounted file picks.
 */
interface PlatformFileSystem {
    suspend fun pickAndScanFolder(): FolderScanBatch?
    suspend fun rescanFolder(folderName: String, nativePathOrUri: String): FolderScanBatch?
    suspend fun readAudioBytes(folderName: String, relativePath: String, fileKey: String): ByteArray?
    suspend fun readHeadBytes(folderName: String, relativePath: String, fileKey: String, maxBytes: Int = 131_072): ByteArray?
    suspend fun saveOfflineAudio(fileKey: String, bytes: ByteArray)
    suspend fun hasOfflineAudio(fileKey: String): Boolean
    suspend fun deleteOfflineAudio(fileKey: String)
    suspend fun exportTextFile(suggestedFileName: String, content: String, mimeType: String): Boolean

    fun isSafeRelativePath(relativePath: String): Boolean {
        val norm = relativePath.replace('\\', '/')
        if (norm.startsWith("/") || norm.contains("../") || norm == "..") return false
        return norm.isNotBlank()
    }
}

data class AuthUserProfile(
    val uid: String,
    val email: String,
    val displayName: String,
    val hasDriveScope: Boolean = false,
    val hasYouTubeScope: Boolean = false,
)

/**
 * Strictly in-memory OAuth access token manager + Firebase ID token provider.
 * Access tokens are never written to disk, SQLite, Keychain, SharedPreferences, or localStorage.
 */
interface PlatformAuth {
    val user: StateFlow<AuthUserProfile?>
    suspend fun signInGoogle(requestDrive: Boolean = false, requestYouTube: Boolean = false): AuthUserProfile
    suspend fun requestAdditionalScopes(drive: Boolean = false, youtube: Boolean = false): AuthUserProfile
    suspend fun getFirebaseIdToken(): String?
    fun getDriveAccessToken(): String?
    fun getYouTubeAccessToken(): String?
    suspend fun signOut()
}

interface PlatformUrlOpener {
    fun openUrl(url: String)
}

expect class PlatformDatabaseDriverFactory {
    fun createDriver(): SqlDriver?
}

expect fun createPlatformHttpClient(): HttpClient
