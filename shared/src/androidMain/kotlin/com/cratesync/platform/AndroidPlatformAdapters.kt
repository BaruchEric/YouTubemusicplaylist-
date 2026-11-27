package com.cratesync.platform

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import com.cratesync.core.AudioTransitions
import com.cratesync.core.isSupportedAudioFileName
import com.cratesync.db.CrateSyncDatabase
import com.cratesync.model.CrossfadeCurve
import com.cratesync.model.ScanErrorCode
import com.cratesync.model.ScanErrorEntry
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import java.io.File
import java.text.Normalizer
import java.util.UUID

actual fun currentTimeMillis(): Long = System.currentTimeMillis()
actual fun randomUuid(): String = UUID.randomUUID().toString()
actual fun normalizeUnicodeNfc(input: String): String = Normalizer.normalize(input, Normalizer.Form.NFC)
actual fun normalizeUnicodeNfkdStripMarks(input: String): String =
    Normalizer.normalize(input, Normalizer.Form.NFKD).replace(Regex("\\p{M}+"), "")
actual fun detectPlatformName(): String = "Android"
actual fun createPlatformHttpClient(): HttpClient = HttpClient(OkHttp)

actual class PlatformDatabaseDriverFactory(private val context: Context) {
    actual fun createDriver(): SqlDriver? =
        AndroidSqliteDriver(CrateSyncDatabase.Schema, context, "cratesync.db")
}

/**
 * Dual-deck Media3 / ExoPlayer audio engine supporting crossfade envelopes and ReplayGain scaling.
 */
class AndroidMedia3AudioEngine(private val context: Context) : PlatformAudioEngine {
    private var primaryDeck: ExoPlayer = ExoPlayer.Builder(context).build()
    private var secondaryDeck: ExoPlayer = ExoPlayer.Builder(context).build()
    private var masterVolume: Float = 0.85f
    private var replayGainLinear: Double = 1.0

    private val _deckState = MutableStateFlow(AudioDeckSnapshot())
    override val deckState: StateFlow<AudioDeckSnapshot> = _deckState.asStateFlow()

    override suspend fun loadAndPlay(audioBytes: ByteArray, mimeType: String, linearGain: Double) {
        replayGainLinear = linearGain
        val tempFile = File(context.cacheDir, "deck_primary_${System.nanoTime()}.audio").apply { writeBytes(audioBytes) }
        primaryDeck.stop()
        primaryDeck.setMediaItem(MediaItem.fromUri(Uri.fromFile(tempFile)))
        primaryDeck.volume = (masterVolume * linearGain.toFloat()).coerceIn(0f, 1f)
        primaryDeck.prepare()
        primaryDeck.play()
        _deckState.value = _deckState.value.copy(isPlaying = true)
    }

    override suspend fun preloadNext(audioBytes: ByteArray, mimeType: String, linearGain: Double) {
        val tempFile = File(context.cacheDir, "deck_next_${System.nanoTime()}.audio").apply { writeBytes(audioBytes) }
        secondaryDeck.stop()
        secondaryDeck.setMediaItem(MediaItem.fromUri(Uri.fromFile(tempFile)))
        secondaryDeck.volume = 0f
        secondaryDeck.prepare()
    }

    override suspend fun crossfadeToNext(durationSec: Double, curve: CrossfadeCurve) {
        val steps = 20
        val stepMs = ((durationSec * 1000.0) / steps).toLong().coerceAtLeast(15L)
        secondaryDeck.play()
        _deckState.value = _deckState.value.copy(isCrossfading = true)
        for (i in 0..steps) {
            val pair = AudioTransitions.evaluateCurve(i.toDouble() / steps, curve)
            primaryDeck.volume = (masterVolume * pair.outgoing.toFloat()).coerceIn(0f, 1f)
            secondaryDeck.volume = (masterVolume * pair.incoming.toFloat()).coerceIn(0f, 1f)
            delay(stepMs)
        }
        primaryDeck.stop()
        val swapped = primaryDeck
        primaryDeck = secondaryDeck
        secondaryDeck = swapped
        _deckState.value = _deckState.value.copy(isPlaying = true, isCrossfading = false)
    }

    override fun play() { primaryDeck.play(); _deckState.value = _deckState.value.copy(isPlaying = true) }
    override fun pause() { primaryDeck.pause(); _deckState.value = _deckState.value.copy(isPlaying = false) }
    override fun seekTo(seconds: Double) { primaryDeck.seekTo((seconds * 1000.0).toLong().coerceAtLeast(0L)) }
    override fun setVolume(volume: Float) {
        masterVolume = volume.coerceIn(0f, 1f)
        primaryDeck.volume = (masterVolume * replayGainLinear.toFloat()).coerceIn(0f, 1f)
    }
    override fun setReplayGainLinear(linearGain: Double) {
        replayGainLinear = linearGain
        primaryDeck.volume = (masterVolume * replayGainLinear.toFloat()).coerceIn(0f, 1f)
    }
    override suspend fun decodeForLoudness(audioBytes: ByteArray): DecodedPcmAudio? = null
    override fun release() { primaryDeck.release(); secondaryDeck.release() }
}

class AndroidFileSystem(private val context: Context) : PlatformFileSystem {
    private val offlineDir = File(context.filesDir, "cratesync_offline_audio").apply { mkdirs() }

    override suspend fun pickAndScanFolder(): FolderScanBatch? {
        val musicDir = File(context.getExternalFilesDir(null), "Music").apply { mkdirs() }
        return rescanFolder(musicDir.name, musicDir.absolutePath)
    }

    override suspend fun rescanFolder(folderName: String, nativePathOrUri: String): FolderScanBatch? {
        val root = File(nativePathOrUri)
        if (!root.exists() || !root.isDirectory) return null
        val files = mutableListOf<ScannedPlatformFile>()
        val errors = mutableListOf<ScanErrorEntry>()
        var total = 0
        var skipped = 0
        root.walkTopDown().forEach { f ->
            if (f.isDirectory) return@forEach
            total++
            if (!isSupportedAudioFileName(f.name)) { skipped++; return@forEach }
            val rel = "$folderName/${f.relativeTo(root).path.replace('\\', '/')}"
            runCatching {
                val len = f.length()
                val head = f.inputStream().use { it.readNBytes(131_072) }
                files += ScannedPlatformFile(f.name, rel, len, head, null)
            }.onFailure { err ->
                errors += ScanErrorEntry(rel, err.message ?: "Read failed", ScanErrorCode.UNREADABLE_FILE)
            }
        }
        return FolderScanBatch(folderName, root.absolutePath, total, skipped, files, errors)
    }

    override suspend fun readAudioBytes(folderName: String, relativePath: String, fileKey: String): ByteArray? {
        if (!isSafeRelativePath(relativePath)) return null
        val offline = File(offlineDir, "${fileKey.hashCode()}.bin")
        if (offline.exists()) return offline.readBytes()
        val f = File(context.getExternalFilesDir(null), relativePath)
        return if (f.exists() && f.isFile) f.readBytes() else null
    }

    override suspend fun readHeadBytes(folderName: String, relativePath: String, fileKey: String, maxBytes: Int): ByteArray? =
        readAudioBytes(folderName, relativePath, fileKey)?.take(maxBytes)?.toByteArray()

    override suspend fun saveOfflineAudio(fileKey: String, bytes: ByteArray) {
        File(offlineDir, "${fileKey.hashCode()}.bin").writeBytes(bytes)
    }

    override suspend fun hasOfflineAudio(fileKey: String): Boolean = File(offlineDir, "${fileKey.hashCode()}.bin").exists()
    override suspend fun deleteOfflineAudio(fileKey: String) { File(offlineDir, "${fileKey.hashCode()}.bin").delete() }
    override suspend fun exportTextFile(suggestedFileName: String, content: String, mimeType: String): Boolean {
        val out = File(context.getExternalFilesDir(null), suggestedFileName)
        out.writeText(content)
        return true
    }
}

class AndroidInMemoryAuth : PlatformAuth {
    private val _user = MutableStateFlow<AuthUserProfile?>(null)
    override val user: StateFlow<AuthUserProfile?> = _user.asStateFlow()
    private var driveToken: String? = null
    private var ytToken: String? = null
    private var idToken: String? = null

    override suspend fun signInGoogle(requestDrive: Boolean, requestYouTube: Boolean): AuthUserProfile {
        error("Configure Android Credential Manager / Google Sign-In client in MainActivity to exchange OAuth tokens in memory.")
    }

    override suspend fun requestAdditionalScopes(drive: Boolean, youtube: Boolean): AuthUserProfile =
        signInGoogle(drive, youtube)

    override suspend fun getFirebaseIdToken(): String? = idToken
    override fun getDriveAccessToken(): String? = driveToken
    override fun getYouTubeAccessToken(): String? = ytToken
    override suspend fun signOut() { driveToken = null; ytToken = null; idToken = null; _user.value = null }
}

class AndroidUrlOpener(private val context: Context) : PlatformUrlOpener {
    override fun openUrl(url: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}
