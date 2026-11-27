package com.cratesync

import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.window.ComposeViewport
import com.cratesync.platform.PlatformDatabaseDriverFactory
import com.cratesync.platform.WasmFileSystem
import com.cratesync.platform.WasmInMemoryAuth
import com.cratesync.platform.WasmUrlOpener
import com.cratesync.platform.WasmWebAudioEngine
import com.cratesync.state.createCrateSyncStore
import com.cratesync.ui.CrateSyncApp
import kotlinx.browser.document
import kotlinx.browser.window
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    val origin = window.location.origin.ifBlank { "http://127.0.0.1:3000" }
    val store = createCrateSyncStore(
        scope = appScope,
        driverFactory = PlatformDatabaseDriverFactory(),
        audioEngine = WasmWebAudioEngine(),
        fileSystem = WasmFileSystem(),
        auth = WasmInMemoryAuth(),
        urlOpener = WasmUrlOpener(),
        apiBaseUrl = origin,
    )
    ComposeViewport(document.body!!) {
        CrateSyncApp(store = store)
    }
}
