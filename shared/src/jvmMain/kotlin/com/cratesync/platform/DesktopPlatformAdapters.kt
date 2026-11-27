package com.cratesync.platform

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.cratesync.core.AudioTransitions
import com.cratesync.core.isSupportedAudioFileName
import com.cratesync.db.CrateSyncDatabase
import com.cratesync.model.CrossfadeCurve
import com.cratesync.model.ScanErrorCode
import com.cratesync.model.ScanErrorEntry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.awt.Desktop
import java.io.ByteArrayInputStream
import java.io.File
import java.net.URI
import java.text.Normalizer
import java.util.UUID
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioSystem
import javax.sound.sampled.Clip
import javax.sound.sampled.FloatControl
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import javax.swing.JFileChooser
import kotlin.math.log10

actual fun currentTimeMillis(): Long = System.currentTimeMillis()
actual fun randomUuid(): String = UUID.randomUUID().toString()
actual fun normalizeUnicodeNfc(input: String): String = Normalizer.normalize(input, Normalizer.Form.NFC)
actual fun normalizeUnicodeNfkdStripMarks(input: String): String =
    Normalizer.normalize(input, Normalizer.Form.NFKD).replace(Regex("\\p{M}+"), "")
actual fun detectPlatformName(): String {
    val os = System.getProperty("os.name").orEmpty().lowercase()
    return when {
        "mac" in os -> "macOS"
        "win" in os -> "Windows"
        else -> "Linux"
    }
}
actual fun createPlatformHttpClient(): HttpClient = HttpClient(CIO)

actual class PlatformDatabaseDriverFactory {
    actual fun createDriver(): SqlDriver? {
        val dir = File(System.getProperty("user.home"), ".cratesync").apply { mkdirs() }
        val dbFile = File(dir, "cratesync.db")
        val driver = JdbcSqliteDriver("jdbc:sqlite:${dbFile.absolutePath}")
        if (!dbFile.exists() || dbFile.length() == 0L) {
            CrateSyncDatabase.Schema.create(driver)
        }
        return driver
    }
}

/**
 * Desktop JVM dual-deck audio engine with PCM loudness decoding, ReplayGain dB attenuation,
 * and timed crossfade curves.
 */
class DesktopAudioEngine : PlatformAudioEngine {
    private var primaryClip: Clip? = null
    private var secondaryClip: Clip? = null
    private var masterVolume: Float = 0.85f
    private var replayGainLinear: Double = 1.0

    private val _deckState = MutableStateFlow(AudioDeckSnapshot())
    override val deckState: StateFlow<AudioDeckSnapshot> = _deckState.asStateFlow()

    private fun openClip(bytes: ByteArray): Clip? = runCatching {
        val raw = AudioSystem.getAudioInputStream(ByteArrayInputStream(bytes))
        val base = raw.format
        val pcmFormat = AudioFormat(
            AudioFormat.Encoding.PCM_SIGNED,
            base.sampleRate,
            16,
            base.channels,
            base.channels * 2,
            base.sampleRate,
            false,
        )
        val decoded = AudioSystem.getAudioInputStream(pcmFormat, raw)
        AudioSystem.getClip().apply { open(decoded) }
    }.getOrNull()

    private fun applyGain(clip: Clip?, linear: Double) {
        if (clip == null || !clip.isControlSupported(FloatControl.Type.MASTER_GAIN)) return
        val ctrl = clip.getControl(FloatControl.Type.MASTER_GAIN) as FloatControl
        val db = if (linear <= 0.0001) ctrl.minimum else (20.0 * log10(linear)).toFloat().coerceIn(ctrl.minimum, ctrl.maximum)
        ctrl.value = db
    }

    override suspend fun loadAndPlay(audioBytes: ByteArray, mimeType: String, linearGain: Double) {
        replayGainLinear = linearGain
        primaryClip?.stop()
        primaryClip?.close()
        primaryClip = openClip(audioBytes)
        applyGain(primaryClip, masterVolume * linearGain)
        primaryClip?.start()
        val dur = (primaryClip?.microsecondLength ?: 0L) / 1_000_000.0
        _deckState.value = _deckState.value.copy(isPlaying = true, positionSec = 0.0, durationSec = dur)
    }

    override suspend fun preloadNext(audioBytes: ByteArray, mimeType: String, linearGain: Double) {
        secondaryClip?.stop()
        secondaryClip?.close()
        secondaryClip = openClip(audioBytes)
        applyGain(secondaryClip, 0.0)
    }

    override suspend fun crossfadeToNext(durationSec: Double, curve: CrossfadeCurve) {
        val steps = 20
        val stepMs = ((durationSec * 1000.0) / steps).toLong().coerceAtLeast(15L)
        secondaryClip?.start()
        _deckState.value = _deckState.value.copy(isCrossfading = true)
        for (i in 0..steps) {
            val pair = AudioTransitions.evaluateCurve(i.toDouble() / steps, curve)
            applyGain(primaryClip, masterVolume * pair.outgoing)
            applyGain(secondaryClip, masterVolume * pair.incoming)
            delay(stepMs)
        }
        primaryClip?.stop()
        primaryClip?.close()
        primaryClip = secondaryClip
        secondaryClip = null
        val dur = (primaryClip?.microsecondLength ?: 0L) / 1_000_000.0
        _deckState.value = _deckState.value.copy(isPlaying = true, isCrossfading = false, durationSec = dur)
    }

    override fun play() { primaryClip?.start(); _deckState.value = _deckState.value.copy(isPlaying = true) }
    override fun pause() { primaryClip?.stop(); _deckState.value = _deckState.value.copy(isPlaying = false) }
    override fun seekTo(seconds: Double) {
        primaryClip?.microsecondPosition = (seconds * 1_000_000.0).toLong().coerceAtLeast(0L)
        _deckState.value = _deckState.value.copy(positionSec = seconds.coerceAtLeast(0.0))
    }
    override fun setVolume(volume: Float) {
        masterVolume = volume.coerceIn(0f, 1f)
        applyGain(primaryClip, masterVolume * replayGainLinear)
    }
    override fun setReplayGainLinear(linearGain: Double) {
        replayGainLinear = linearGain
        applyGain(primaryClip, masterVolume * replayGainLinear)
    }
    override suspend fun decodeForLoudness(audioBytes: ByteArray): DecodedPcmAudio? = withContext(Dispatchers.IO) {
        runCatching {
            val raw = AudioSystem.getAudioInputStream(ByteArrayInputStream(audioBytes))
            val base = raw.format
            val channels = base.channels.coerceIn(1, 2)
            val pcmFormat = AudioFormat(AudioFormat.Encoding.PCM_SIGNED, base.sampleRate, 16, channels, channels * 2, base.sampleRate, false)
            val bytes = AudioSystem.getAudioInputStream(pcmFormat, raw).readBytes()
            val frameCount = bytes.size / (channels * 2)
            val planar = List(channels) { FloatArray(frameCount) }
            var idx = 0
            for (f in 0 until frameCount) {
                for (ch in 0 until channels) {
                    val lo = bytes[idx++].toInt() and 0xff
                    val hi = bytes[idx++].toInt()
                    val sample = ((hi shl 8) or lo).toShort()
                    planar[ch][f] = sample / 32768f
                }
            }
            DecodedPcmAudio(planar, base.sampleRate.toInt())
        }.getOrNull()
    }
    override fun release() { primaryClip?.close(); secondaryClip?.close() }
}

class DesktopFileSystem : PlatformFileSystem {
    private val mountedRoots = mutableMapOf<String, File>()
    private val offlineDir = File(System.getProperty("user.home"), ".cratesync/offline_audio").apply { mkdirs() }

    override suspend fun pickAndScanFolder(): FolderScanBatch? = withContext(Dispatchers.IO) {
        val chooser = JFileChooser().apply {
            fileSelectionMode = JFileChooser.DIRECTORIES_ONLY
            dialogTitle = "Select Local Music Folder"
        }
        val res = chooser.showOpenDialog(null)
        if (res != JFileChooser.APPROVE_OPTION) return@withContext null
        val dir = chooser.selectedFile ?: return@withContext null
        rescanFolder(dir.name, dir.absolutePath)
    }

    override suspend fun rescanFolder(folderName: String, nativePathOrUri: String): FolderScanBatch? = withContext(Dispatchers.IO) {
        val root = File(nativePathOrUri)
        if (!root.exists() || !root.isDirectory) return@withContext null
        mountedRoots[folderName] = root
        val audioFiles = mutableListOf<ScannedPlatformFile>()
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
                val tail = if (len > 128L) {
                    f.inputStream().use { ins -> ins.skip(len - 128L); ins.readNBytes(128) }
                } else null
                audioFiles += ScannedPlatformFile(f.name, rel, len, head, tail)
            }.onFailure { err ->
                errors += ScanErrorEntry(rel, err.message ?: "Unable to read file", ScanErrorCode.UNREADABLE_FILE)
            }
        }
        FolderScanBatch(folderName, root.absolutePath, total, skipped, audioFiles, errors)
    }

    override suspend fun readAudioBytes(folderName: String, relativePath: String, fileKey: String): ByteArray? = withContext(Dispatchers.IO) {
        if (!isSafeRelativePath(relativePath)) return@withContext null
        val offline = File(offlineDir, "${fileKey.hashCode()}.bin")
        if (offline.exists()) return@withContext offline.readBytes()
        val root = mountedRoots[folderName] ?: return@withContext null
        val sub = relativePath.removePrefix("$folderName/")
        val target = File(root, sub).canonicalFile
        if (!target.path.startsWith(root.canonicalPath)) return@withContext null
        if (target.exists() && target.isFile) target.readBytes() else null
    }

    override suspend fun readHeadBytes(folderName: String, relativePath: String, fileKey: String, maxBytes: Int): ByteArray? =
        readAudioBytes(folderName, relativePath, fileKey)?.take(maxBytes)?.toByteArray()

    override suspend fun saveOfflineAudio(fileKey: String, bytes: ByteArray) {
        withContext(Dispatchers.IO) { File(offlineDir, "${fileKey.hashCode()}.bin").writeBytes(bytes) }
    }

    override suspend fun hasOfflineAudio(fileKey: String): Boolean = File(offlineDir, "${fileKey.hashCode()}.bin").exists()
    override suspend fun deleteOfflineAudio(fileKey: String) { File(offlineDir, "${fileKey.hashCode()}.bin").delete() }
    override suspend fun exportTextFile(suggestedFileName: String, content: String, mimeType: String): Boolean = withContext(Dispatchers.IO) {
        val chooser = JFileChooser().apply { selectedFile = File(suggestedFileName) }
        if (chooser.showSaveDialog(null) != JFileChooser.APPROVE_OPTION) return@withContext false
        chooser.selectedFile.writeText(content)
        true
    }
}

class DesktopInMemoryAuth : PlatformAuth {
    private val _user = MutableStateFlow<AuthUserProfile?>(null)
    override val user: StateFlow<AuthUserProfile?> = _user.asStateFlow()
    private var driveToken: String? = null
    private var ytToken: String? = null
    private var idToken: String? = null

    override suspend fun signInGoogle(requestDrive: Boolean, requestYouTube: Boolean): AuthUserProfile {
        error("Start loopback PKCE Google OAuth flow on localhost with your OAuth Client ID to acquire in-memory tokens.")
    }
    override suspend fun requestAdditionalScopes(drive: Boolean, youtube: Boolean): AuthUserProfile = signInGoogle(drive, youtube)
    override suspend fun getFirebaseIdToken(): String? = idToken
    override fun getDriveAccessToken(): String? = driveToken
    override fun getYouTubeAccessToken(): String? = ytToken
    override suspend fun signOut() { driveToken = null; ytToken = null; idToken = null; _user.value = null }
}

class DesktopUrlOpener : PlatformUrlOpener {
    override fun openUrl(url: String) {
        if (Desktop.isDesktopSupported()) runCatching { Desktop.getDesktop().browse(URI(url)) }
    }
}
