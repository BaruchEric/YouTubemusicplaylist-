package com.cratesync

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.cratesync.platform.AndroidFileSystem
import com.cratesync.platform.AndroidInMemoryAuth
import com.cratesync.platform.AndroidMedia3AudioEngine
import com.cratesync.platform.AndroidUrlOpener
import com.cratesync.platform.PlatformDatabaseDriverFactory
import com.cratesync.state.CrateSyncStore
import com.cratesync.state.createCrateSyncStore
import com.cratesync.ui.CrateSyncApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

class MainActivity : ComponentActivity() {
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var audioEngine: AndroidMedia3AudioEngine
    private lateinit var store: CrateSyncStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        audioEngine = AndroidMedia3AudioEngine(applicationContext)
        store = createCrateSyncStore(
            scope = appScope,
            driverFactory = PlatformDatabaseDriverFactory(applicationContext),
            audioEngine = audioEngine,
            fileSystem = AndroidFileSystem(applicationContext),
            auth = AndroidInMemoryAuth(),
            urlOpener = AndroidUrlOpener(applicationContext),
            apiBaseUrl = "http://10.0.2.2:3000",
        )
        setContent {
            CrateSyncApp(store = store)
        }
    }

    override fun onDestroy() {
        audioEngine.release()
        appScope.cancel()
        super.onDestroy()
    }
}
