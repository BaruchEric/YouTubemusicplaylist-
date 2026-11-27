package com.cratesync

import androidx.compose.ui.window.ComposeUIViewController
import com.cratesync.platform.IosAvAudioEngine
import com.cratesync.platform.IosFileSystem
import com.cratesync.platform.IosInMemoryAuth
import com.cratesync.platform.IosUrlOpener
import com.cratesync.platform.PlatformDatabaseDriverFactory
import com.cratesync.state.createCrateSyncStore
import com.cratesync.ui.CrateSyncApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import platform.UIKit.UIViewController

fun MainViewController(): UIViewController {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    val store = createCrateSyncStore(
        scope = appScope,
        driverFactory = PlatformDatabaseDriverFactory(),
        audioEngine = IosAvAudioEngine(),
        fileSystem = IosFileSystem(),
        auth = IosInMemoryAuth(),
        urlOpener = IosUrlOpener(),
        apiBaseUrl = "http://127.0.0.1:3000",
    )
    return ComposeUIViewController {
        CrateSyncApp(store = store)
    }
}
