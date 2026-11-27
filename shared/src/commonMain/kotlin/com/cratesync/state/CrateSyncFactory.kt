package com.cratesync.state

import com.cratesync.ai.AiProxyClient
import com.cratesync.drive.GoogleDriveApiClient
import com.cratesync.model.ToastLevel
import com.cratesync.platform.PlatformAudioEngine
import com.cratesync.platform.PlatformAuth
import com.cratesync.platform.PlatformDatabaseDriverFactory
import com.cratesync.platform.PlatformFileSystem
import com.cratesync.platform.PlatformUrlOpener
import com.cratesync.platform.createPlatformHttpClient
import com.cratesync.youtube.KtorYouTubeApiClient
import kotlinx.coroutines.CoroutineScope

/**
 * Shared composition root that wires SQLDelight, Ktor clients, dual-deck PlaybackController,
 * and the unidirectional CrateSyncStore for any KMP target (Android, iOS, Desktop, Web).
 */
fun createCrateSyncStore(
    scope: CoroutineScope,
    driverFactory: PlatformDatabaseDriverFactory,
    audioEngine: PlatformAudioEngine,
    fileSystem: PlatformFileSystem,
    auth: PlatformAuth,
    urlOpener: PlatformUrlOpener,
    apiBaseUrl: String = "http://127.0.0.1:3000",
): CrateSyncStore {
    val httpClient = createPlatformHttpClient()
    val repository = LibraryRepository(driverFactory)
    val driveClient = GoogleDriveApiClient(httpClient) { auth.getDriveAccessToken() }
    val youtubeApi = KtorYouTubeApiClient(httpClient) { auth.getYouTubeAccessToken() }
    val aiClient = AiProxyClient(
        httpClient = httpClient,
        baseUrlProvider = { apiBaseUrl },
        firebaseIdTokenProvider = { auth.getFirebaseIdToken() },
    )
    var storeRef: CrateSyncStore? = null
    val playback = PlaybackController(
        scope = scope,
        repository = repository,
        audioEngine = audioEngine,
        fileSystem = fileSystem,
        driveClient = driveClient,
        onToast = { message -> storeRef?.showToast(message, ToastLevel.WARNING) },
    )
    return CrateSyncStore(
        scope = scope,
        repository = repository,
        playback = playback,
        fileSystem = fileSystem,
        auth = auth,
        driveClient = driveClient,
        youtubeApi = youtubeApi,
        aiClient = aiClient,
        urlOpener = urlOpener,
    ).also { storeRef = it }
}
