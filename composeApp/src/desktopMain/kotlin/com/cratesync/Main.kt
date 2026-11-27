package com.cratesync

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import com.cratesync.platform.DesktopAudioEngine
import com.cratesync.platform.DesktopFileSystem
import com.cratesync.platform.DesktopInMemoryAuth
import com.cratesync.platform.DesktopUrlOpener
import com.cratesync.platform.PlatformDatabaseDriverFactory
import com.cratesync.state.createCrateSyncStore
import com.cratesync.ui.CrateSyncApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

fun main() = application {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    val audioEngine = DesktopAudioEngine()
    val apiBaseUrl = System.getenv("CRATESYNC_API_BASE_URL") ?: "http://127.0.0.1:3000"
    val store = createCrateSyncStore(
        scope = appScope,
        driverFactory = PlatformDatabaseDriverFactory(),
        audioEngine = audioEngine,
        fileSystem = DesktopFileSystem(),
        auth = DesktopInMemoryAuth(),
        urlOpener = DesktopUrlOpener(),
        apiBaseUrl = apiBaseUrl,
    )

    Window(
        onCloseRequest = {
            audioEngine.release()
            appScope.cancel()
            exitApplication()
        },
        title = "CrateSync",
        state = rememberWindowState(size = DpSize(1320.dp, 860.dp)),
    ) {
        CrateSyncApp(store = store)
    }
}
