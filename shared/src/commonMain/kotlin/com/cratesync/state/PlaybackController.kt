package com.cratesync.state

import com.cratesync.core.AppliedReplayGainInfo
import com.cratesync.core.AudioTransitions
import com.cratesync.core.BinaryAudioParser
import com.cratesync.core.ReplayGainEngine
import com.cratesync.core.SmartShuffle
import com.cratesync.core.UpcomingTransitionDescription
import com.cratesync.drive.GoogleDriveApiClient
import com.cratesync.model.LocalTrack
import com.cratesync.model.PlayEventOutcome
import com.cratesync.model.PlayHistoryEntry
import com.cratesync.model.TrackPlayStats
import com.cratesync.platform.PlatformAudioEngine
import com.cratesync.platform.PlatformFileSystem
import com.cratesync.platform.currentTimeMillis
import com.cratesync.platform.randomUuid
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class RepeatMode { OFF, ALL, ONE }

data class PlaybackUiState(
    val currentTrack: LocalTrack? = null,
    val queue: List<LocalTrack> = emptyList(),
    val queueIndex: Int = -1,
    val isPlaying: Boolean = false,
    val positionSec: Double = 0.0,
    val durationSec: Double = 0.0,
    val volume: Float = 0.85f,
    val isShuffled: Boolean = false,
    val repeatMode: RepeatMode = RepeatMode.OFF,
    val audioSourceLabel: String = "",
    val appliedReplayGain: AppliedReplayGainInfo? = null,
    val upcomingTransition: UpcomingTransitionDescription? = null,
    val isCrossfading: Boolean = false,
)

/**
 * Coordinates dual-deck playback, DeviceAudioResolver priority chain
 * (memory -> offline cache -> mounted folder -> Google Drive stream + tag enrichment -> YouTube fallback),
 * ReplayGain loudness targeting, crossfade/gapless transitions, Smart Shuffle, and listening telemetry.
 */
class PlaybackController(
    private val scope: CoroutineScope,
    private val repository: LibraryRepository,
    private val audioEngine: PlatformAudioEngine,
    private val fileSystem: PlatformFileSystem,
    private val driveClient: GoogleDriveApiClient,
    private val onToast: (String) -> Unit,
) {
    private val memoryAudioCache = LinkedHashMap<String, ByteArray>()
    private var unshuffledQueue: List<LocalTrack> = emptyList()

    private val _state = MutableStateFlow(PlaybackUiState())
    val state: StateFlow<PlaybackUiState> = _state.asStateFlow()

    init {
        scope.launch {
            audioEngine.deckState.collect { deck ->
                val cur = _state.value
                _state.value = cur.copy(
                    isPlaying = deck.isPlaying,
                    positionSec = deck.positionSec,
                    durationSec = if (deck.durationSec > 0.0) deck.durationSec else cur.currentTrack?.duration ?: 0.0,
                    isCrossfading = deck.isCrossfading,
                )
            }
        }
    }

    fun playTrackInQueue(track: LocalTrack, queue: List<LocalTrack>) {
        unshuffledQueue = queue.ifEmpty { listOf(track) }
        val activeQueue = if (_state.value.isShuffled) {
            SmartShuffle.orderQueue(unshuffledQueue, track.id, repository.playStats.value, currentTimeMillis())
        } else {
            unshuffledQueue
        }
        val idx = activeQueue.indexOfFirst { it.id == track.id }.coerceAtLeast(0)
        scope.launch { startIndex(activeQueue, idx, isManualSkip = false) }
    }

    fun togglePlayPause() {
        val cur = _state.value
        if (cur.currentTrack == null) return
        if (cur.isPlaying) audioEngine.pause() else audioEngine.play()
    }

    fun seekTo(seconds: Double) = audioEngine.seekTo(seconds)

    fun setVolume(volume: Float) {
        val clamped = volume.coerceIn(0f, 1f)
        audioEngine.setVolume(clamped)
        _state.value = _state.value.copy(volume = clamped)
    }

    fun toggleShuffle() {
        val cur = _state.value
        val nextShuffled = !cur.isShuffled
        val nextQueue = if (nextShuffled) {
            SmartShuffle.orderQueue(unshuffledQueue, cur.currentTrack?.id, repository.playStats.value, currentTimeMillis())
        } else {
            unshuffledQueue
        }
        val nextIdx = nextQueue.indexOfFirst { it.id == cur.currentTrack?.id }.coerceAtLeast(0)
        _state.value = cur.copy(
            isShuffled = nextShuffled,
            queue = nextQueue,
            queueIndex = nextIdx,
            upcomingTransition = describeNext(cur.currentTrack, nextQueue.getOrNull(nextIdx + 1), nextShuffled),
        )
    }

    fun cycleRepeatMode() {
        val next = when (_state.value.repeatMode) {
            RepeatMode.OFF -> RepeatMode.ALL
            RepeatMode.ALL -> RepeatMode.ONE
            RepeatMode.ONE -> RepeatMode.OFF
        }
        _state.value = _state.value.copy(repeatMode = next)
    }

    fun skipNext() {
        val cur = _state.value
        if (cur.queue.isEmpty()) return
        recordTelemetry(cur.currentTrack, cur.positionSec, cur.durationSec, manualSkip = true)
        val nextIdx = when {
            cur.queueIndex + 1 < cur.queue.size -> cur.queueIndex + 1
            cur.repeatMode == RepeatMode.ALL -> 0
            else -> return
        }
        scope.launch { startIndex(cur.queue, nextIdx, isManualSkip = true) }
    }

    fun skipPrevious() {
        val cur = _state.value
        if (cur.queue.isEmpty()) return
        if (cur.positionSec > 3.0) {
            audioEngine.seekTo(0.0)
            return
        }
        val prevIdx = (cur.queueIndex - 1).coerceAtLeast(0)
        scope.launch { startIndex(cur.queue, prevIdx, isManualSkip = true) }
    }

    private suspend fun startIndex(queue: List<LocalTrack>, idx: Int, isManualSkip: Boolean) {
        val track = queue.getOrNull(idx) ?: return
        val nextTrack = queue.getOrNull(idx + 1)
        val transitions = repository.transitionSettings.value

        val resolved = resolveAudioBytes(track)
        if (resolved == null) {
            _state.value = _state.value.copy(
                currentTrack = track,
                queue = queue,
                queueIndex = idx,
                isPlaying = false,
                audioSourceLabel = if (!track.youtubeVideoId.isNullOrBlank()) "YouTube Fallback" else "Unavailable",
                upcomingTransition = describeNext(track, nextTrack, _state.value.isShuffled),
            )
            onToast(
                if (!track.youtubeVideoId.isNullOrBlank()) "Local audio unavailable — open in YouTube Music."
                else "Audio file not accessible on this device. Re-scan folder or cache from Drive."
            )
            return
        }

        val (bytes, sourceLabel) = resolved
        val rgInfo = resolveReplayGain(track, bytes)
        val linearGain = rgInfo?.linearGain ?: 1.0

        val shouldCrossfade = isManualSkip && transitions.manualSkipCrossfade &&
            transitions.crossfadeSeconds > 0.0 && _state.value.isPlaying

        if (shouldCrossfade) {
            audioEngine.preloadNext(bytes, mimeForFormat(track.format), linearGain)
            audioEngine.crossfadeToNext(transitions.crossfadeSeconds, transitions.crossfadeCurve)
        } else {
            audioEngine.loadAndPlay(bytes, mimeForFormat(track.format), linearGain)
        }

        _state.value = _state.value.copy(
            currentTrack = track,
            queue = queue,
            queueIndex = idx,
            isPlaying = true,
            durationSec = track.duration,
            audioSourceLabel = sourceLabel,
            appliedReplayGain = rgInfo,
            upcomingTransition = describeNext(track, nextTrack, _state.value.isShuffled),
        )
    }

    private suspend fun resolveAudioBytes(track: LocalTrack): Pair<ByteArray, String>? {
        memoryAudioCache[track.fileKey]?.let { return it to "Memory Cache" }

        val localBytes = fileSystem.readAudioBytes(track.folderName, track.relativePath, track.fileKey)
        if (localBytes != null) {
            cacheInMemory(track.fileKey, localBytes)
            val label = if (fileSystem.hasOfflineAudio(track.fileKey)) "Offline Store" else "Device Folder"
            return localBytes to label
        }

        val driveId = track.driveFileId
        if (!driveId.isNullOrBlank()) {
            val downloaded = runCatching { driveClient.downloadFileBytes(driveId) }.getOrNull()
            if (downloaded != null) {
                cacheInMemory(track.fileKey, downloaded)
                fileSystem.saveOfflineAudio(track.fileKey, downloaded)
                enrichDriveTrackMetadata(track, downloaded)
                return downloaded to "Google Drive"
            }
        }
        return null
    }

    private fun enrichDriveTrackMetadata(track: LocalTrack, bytes: ByteArray) {
        val parsed = BinaryAudioParser.parseHeaderAndTail(bytes, bytes.takeLast(128).toByteArray(), bytes.size.toLong(), track.fileName)
        val now = currentTimeMillis()
        val updated = repository.tracks.value.map { t ->
            if (t.id != track.id) t
            else t.copy(
                title = parsed.title?.takeIf { it.isNotBlank() && t.title == t.fileName } ?: t.title,
                artist = parsed.artist?.takeIf { it.isNotBlank() && t.artist == "Unknown Artist" } ?: t.artist,
                album = parsed.album?.takeIf { it.isNotBlank() && t.album == "Unknown Album" } ?: t.album,
                duration = if (t.duration <= 0.0 && parsed.durationSeconds > 0.0) parsed.durationSeconds else t.duration,
                cachedOnDeviceAt = now,
            )
        }
        repository.setTracks(updated, now)
    }

    private suspend fun resolveReplayGain(track: LocalTrack, bytes: ByteArray): AppliedReplayGainInfo? {
        val rgSettings = repository.replayGainSettings.value
        val cache = repository.loudnessCache.value
        if (track.fileKey !in cache) {
            val decoded = audioEngine.decodeForLoudness(bytes)
            if (decoded != null) {
                val measured = ReplayGainEngine.analyzePcmLoudness(decoded.channels, decoded.sampleRate, currentTimeMillis(), track.album)
                repository.saveLoudness(track.fileKey, measured)
            }
        }
        val albumMap = repository.tracks.value.associate { it.fileKey to it.album }
        return ReplayGainEngine.computeAdjustment(track.fileKey, track.album, repository.loudnessCache.value, rgSettings, albumMap)
    }

    private fun recordTelemetry(track: LocalTrack?, listenedSec: Double, durationSec: Double, manualSkip: Boolean) {
        if (track == null || listenedSec < 5.0) return
        val completed = !manualSkip || (durationSec > 0.0 && listenedSec >= durationSec * 0.75)
        val outcome = if (completed) PlayEventOutcome.COMPLETED else PlayEventOutcome.SKIPPED
        val now = currentTimeMillis()
        val prev = repository.playStats.value[track.id] ?: TrackPlayStats()
        val nextStats = prev.copy(
            playCount = prev.playCount + 1,
            completedCount = prev.completedCount + if (completed) 1 else 0,
            skipCount = prev.skipCount + if (!completed) 1 else 0,
            lastPlayedAt = now,
        )
        val entry = PlayHistoryEntry(
            id = randomUuid(),
            trackId = track.id,
            title = track.title,
            artist = track.artist,
            album = track.album,
            coverArtUrl = track.coverArtUrl,
            playedAt = now,
            outcome = outcome,
            listenedSeconds = listenedSec,
            duration = durationSec,
        )
        repository.recordPlayEvent(entry, nextStats)
    }

    private fun describeNext(current: LocalTrack?, next: LocalTrack?, shuffled: Boolean): UpcomingTransitionDescription =
        AudioTransitions.describeUpcoming(current, next, shuffled, repository.transitionSettings.value)

    private fun cacheInMemory(fileKey: String, bytes: ByteArray) {
        memoryAudioCache[fileKey] = bytes
        while (memoryAudioCache.size > 6) {
            val oldest = memoryAudioCache.keys.firstOrNull() ?: break
            memoryAudioCache.remove(oldest)
        }
    }

    private fun mimeForFormat(format: String): String = when (format.uppercase()) {
        "MP3" -> "audio/mpeg"
        "FLAC" -> "audio/flac"
        "M4A", "MP4", "AAC", "ALAC" -> "audio/mp4"
        "WAV" -> "audio/wav"
        "OGG", "OGA" -> "audio/ogg"
        "OPUS" -> "audio/opus"
        else -> "audio/mpeg"
    }
}
