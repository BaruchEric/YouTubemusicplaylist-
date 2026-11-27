package com.cratesync.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.QueueMusic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cratesync.model.DirectoryWatcherStatus
import com.cratesync.model.LegalLinks
import com.cratesync.model.Playlist
import com.cratesync.model.SmartPlaylist
import com.cratesync.model.WorkspaceView
import com.cratesync.ui.theme.CrateColors
import com.cratesync.ui.theme.CrateType

@Composable
fun AdaptiveShell(
    activeView: WorkspaceView,
    selectedPlaylistId: String?,
    selectedSmartPlaylistId: String?,
    playlists: List<Playlist>,
    smartPlaylists: List<SmartPlaylist>,
    watcherStatus: DirectoryWatcherStatus,
    scanProgressLabel: String,
    watchedFolderCount: Int,
    pendingDiffCount: Int,
    onNavigate: (WorkspaceView, String?, String?) -> Unit,
    onOpenSearch: () -> Unit,
    onScanFolder: () -> Unit,
    onCreatePlaylist: () -> Unit,
    onOpenUrl: (String) -> Unit,
    miniPlayer: @Composable () -> Unit,
    content: @Composable () -> Unit,
) {
    BoxWithConstraints(
        modifier = Modifier.fillMaxSize().background(CrateColors.Canvas)
    ) {
        val isCompact = maxWidth < 840.dp

        if (isCompact) {
            // Mobile Adaptive Layout (52dp TopBar + scrollable content + docked MiniPlayer + thumb-zone BottomNav)
            Column(modifier = Modifier.fillMaxSize()) {
                MobileTopBar(
                    activeView = activeView,
                    watcherStatus = watcherStatus,
                    onWatcherClick = { onNavigate(WorkspaceView.SCAN_LOGS, null, null) },
                    onSearchClick = onOpenSearch,
                    onScanClick = onScanFolder,
                )
                Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    content()
                }
                miniPlayer()
                MobileBottomNav(
                    activeView = activeView,
                    onNavigate = { v -> onNavigate(v, null, null) },
                )
            }
        } else {
            // Desktop & Web Studio Layout (260dp Sidebar + 56dp TopBar + Main Viewport + MiniPlayer)
            Column(modifier = Modifier.fillMaxSize()) {
                Row(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    StudioSidebar(
                        activeView = activeView,
                        selectedPlaylistId = selectedPlaylistId,
                        selectedSmartPlaylistId = selectedSmartPlaylistId,
                        playlists = playlists,
                        smartPlaylists = smartPlaylists,
                        watchedFolderCount = watchedFolderCount,
                        pendingDiffCount = pendingDiffCount,
                        onNavigate = onNavigate,
                        onCreatePlaylist = onCreatePlaylist,
                        onOpenUrl = onOpenUrl,
                    )
                    Column(modifier = Modifier.weight(1f).fillMaxHeight()) {
                        DesktopTopBar(
                            activeView = activeView,
                            watcherStatus = watcherStatus,
                            scanProgressLabel = scanProgressLabel,
                            pendingDiffCount = pendingDiffCount,
                            onWatcherClick = { onNavigate(WorkspaceView.SCAN_LOGS, null, null) },
                            onSearchClick = onOpenSearch,
                            onScanClick = onScanFolder,
                            onSyncClick = { onNavigate(WorkspaceView.SYNC, null, null) },
                        )
                        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                            content()
                        }
                    }
                }
                miniPlayer()
            }
        }
    }
}

@Composable
private fun StudioSidebar(
    activeView: WorkspaceView,
    selectedPlaylistId: String?,
    selectedSmartPlaylistId: String?,
    playlists: List<Playlist>,
    smartPlaylists: List<SmartPlaylist>,
    watchedFolderCount: Int,
    pendingDiffCount: Int,
    onNavigate: (WorkspaceView, String?, String?) -> Unit,
    onCreatePlaylist: () -> Unit,
    onOpenUrl: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .width(260.dp)
            .fillMaxHeight()
            .background(CrateColors.NavChrome)
            .border(width = 1.dp, color = CrateColors.BorderHairline)
            .padding(vertical = 14.dp, horizontal = 12.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
        ) {
            Box(
                modifier = Modifier.size(28.dp).clip(RoundedCornerShape(6.dp)).background(CrateColors.Accent),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.LibraryMusic, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column {
                Text("CrateSync", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = CrateColors.TextPrimary)
                Text("KMP Studio · $watchedFolderCount folders", style = CrateType.TabularMono, fontSize = 11.sp)
            }
        }

        Spacer(Modifier.height(12.dp))

        Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            SidebarNavItem("Dashboard", Icons.Default.Dashboard, activeView == WorkspaceView.DASHBOARD) {
                onNavigate(WorkspaceView.DASHBOARD, null, null)
            }
            SidebarNavItem("Device Storage", Icons.Default.FolderOpen, activeView == WorkspaceView.SCANNER) {
                onNavigate(WorkspaceView.SCANNER, null, null)
            }
            SidebarNavItem(
                label = if (pendingDiffCount > 0) "Sync Queue · $pendingDiffCount" else "Sync Queue",
                icon = Icons.Default.Sync,
                selected = activeView == WorkspaceView.SYNC,
            ) {
                onNavigate(WorkspaceView.SYNC, null, null)
            }
            SidebarNavItem("Scan Logs", Icons.Default.History, activeView == WorkspaceView.SCAN_LOGS) {
                onNavigate(WorkspaceView.SCAN_LOGS, null, null)
            }
            SidebarNavItem("Drive Sync & Transfer", Icons.Default.CloudSync, activeView == WorkspaceView.TRANSFER) {
                onNavigate(WorkspaceView.TRANSFER, null, null)
            }

            Spacer(Modifier.height(14.dp))
            HorizontalDivider(color = CrateColors.BorderHairline)
            Spacer(Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("SMART PLAYLISTS", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = CrateColors.TextMuted)
            }
            Spacer(Modifier.height(4.dp))
            for (sp in smartPlaylists) {
                SidebarNavItem(
                    label = sp.name,
                    icon = Icons.Default.AutoAwesome,
                    selected = activeView == WorkspaceView.SMART_PLAYLIST && selectedSmartPlaylistId == sp.id,
                ) {
                    onNavigate(WorkspaceView.SMART_PLAYLIST, null, sp.id)
                }
            }

            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("PLAYLISTS", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = CrateColors.TextMuted)
                IconButton(onClick = onCreatePlaylist, modifier = Modifier.size(28.dp)) {
                    Icon(Icons.Default.Add, contentDescription = "Create playlist", tint = CrateColors.TextSecondary, modifier = Modifier.size(16.dp))
                }
            }
            for (pl in playlists) {
                SidebarNavItem(
                    label = "${pl.name} · ${pl.trackIds.size}",
                    icon = Icons.Default.QueueMusic,
                    selected = activeView == WorkspaceView.PLAYLIST && selectedPlaylistId == pl.id,
                ) {
                    onNavigate(WorkspaceView.PLAYLIST, pl.id, null)
                }
            }
        }

        HorizontalDivider(color = CrateColors.BorderHairline)
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "Privacy",
                fontSize = 11.sp,
                color = CrateColors.TextMuted,
                modifier = Modifier.clickable { onOpenUrl(LegalLinks.PRIVACY_URL) },
            )
            Text("·", fontSize = 11.sp, color = CrateColors.TextMuted)
            Text(
                "Terms",
                fontSize = 11.sp,
                color = CrateColors.TextMuted,
                modifier = Modifier.clickable { onOpenUrl(LegalLinks.TERMS_URL) },
            )
            Text("·", fontSize = 11.sp, color = CrateColors.TextMuted)
            Text(
                "YT Terms",
                fontSize = 11.sp,
                color = CrateColors.TextMuted,
                modifier = Modifier.clickable { onOpenUrl(LegalLinks.YOUTUBE_TERMS_URL) },
            )
        }
    }
}

@Composable
private fun SidebarNavItem(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 38.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) CrateColors.SurfaceElevated else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = if (selected) CrateColors.Accent else CrateColors.TextSecondary,
            modifier = Modifier.size(17.dp),
        )
        Spacer(Modifier.width(10.dp))
        Text(
            text = label,
            fontSize = 13.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            color = if (selected) CrateColors.TextPrimary else CrateColors.TextSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun DesktopTopBar(
    activeView: WorkspaceView,
    watcherStatus: DirectoryWatcherStatus,
    scanProgressLabel: String,
    pendingDiffCount: Int,
    onWatcherClick: () -> Unit,
    onSearchClick: () -> Unit,
    onScanClick: () -> Unit,
    onSyncClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .background(CrateColors.NavChrome)
            .border(width = 1.dp, color = CrateColors.BorderHairline)
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                text = workspaceTitle(activeView),
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                color = CrateColors.TextPrimary,
            )
            WatcherStatusControl(
                status = watcherStatus,
                progressLabel = scanProgressLabel,
                onClick = onWatcherClick,
            )
        }

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(
                onClick = onSearchClick,
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.height(36.dp),
            ) {
                Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(6.dp))
                Text("Smart Search (Ctrl+K)", fontSize = 12.sp)
            }
            Button(
                onClick = onScanClick,
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = CrateColors.Accent),
                modifier = Modifier.height(36.dp),
            ) {
                Icon(Icons.Default.FolderOpen, contentDescription = null, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(6.dp))
                Text("Scan Folder", fontSize = 12.sp)
            }
            if (pendingDiffCount > 0) {
                OutlinedButton(
                    onClick = onSyncClick,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.height(36.dp),
                ) {
                    Text("Sync ($pendingDiffCount)", fontSize = 12.sp, color = CrateColors.Amber)
                }
            }
        }
    }
}

@Composable
private fun MobileTopBar(
    activeView: WorkspaceView,
    watcherStatus: DirectoryWatcherStatus,
    onWatcherClick: () -> Unit,
    onSearchClick: () -> Unit,
    onScanClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
            .background(CrateColors.NavChrome)
            .border(width = 1.dp, color = CrateColors.BorderHairline)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = workspaceTitle(activeView),
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            color = CrateColors.TextPrimary,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            WatcherStatusControl(watcherStatus, "", onWatcherClick)
            IconButton(onClick = onSearchClick, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Default.Search, contentDescription = "Smart Search", tint = CrateColors.TextPrimary)
            }
            IconButton(onClick = onScanClick, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Default.FolderOpen, contentDescription = "Scan Folder", tint = CrateColors.Accent)
            }
        }
    }
}

@Composable
private fun MobileBottomNav(
    activeView: WorkspaceView,
    onNavigate: (WorkspaceView) -> Unit,
) {
    val items = listOf(
        Triple(WorkspaceView.DASHBOARD, "Home", Icons.Default.Dashboard),
        Triple(WorkspaceView.SCANNER, "Storage", Icons.Default.FolderOpen),
        Triple(WorkspaceView.PLAYLIST, "Lists", Icons.Default.QueueMusic),
        Triple(WorkspaceView.SYNC, "Sync", Icons.Default.Sync),
        Triple(WorkspaceView.TRANSFER, "Drive", Icons.Default.CloudSync),
    )
    NavigationBar(
        containerColor = CrateColors.NavChrome,
        tonalElevation = 0.dp,
        modifier = Modifier.height(62.dp).border(width = 1.dp, color = CrateColors.BorderHairline),
    ) {
        for ((view, label, icon) in items) {
            NavigationBarItem(
                selected = activeView == view,
                onClick = { onNavigate(view) },
                icon = { Icon(icon, contentDescription = label, modifier = Modifier.size(20.dp)) },
                label = { Text(label, fontSize = 11.sp) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = CrateColors.Accent,
                    selectedTextColor = CrateColors.TextPrimary,
                    unselectedIconColor = CrateColors.TextSecondary,
                    unselectedTextColor = CrateColors.TextMuted,
                    indicatorColor = CrateColors.AccentMuted,
                ),
            )
        }
    }
}

@Composable
fun WatcherStatusControl(
    status: DirectoryWatcherStatus,
    progressLabel: String,
    onClick: () -> Unit,
) {
    val (color, icon, label) = when (status) {
        DirectoryWatcherStatus.WATCHING -> Triple(CrateColors.Emerald, Icons.Default.Visibility, "Watching")
        DirectoryWatcherStatus.SYNCING -> Triple(CrateColors.Amber, Icons.Default.Refresh, progressLabel.ifBlank { "Syncing" })
        DirectoryWatcherStatus.PAUSED -> Triple(CrateColors.Amber, Icons.Default.PauseCircle, "Paused")
        DirectoryWatcherStatus.IDLE -> Triple(CrateColors.TextMuted, Icons.Default.History, "Idle")
    }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(CrateColors.SurfaceElevated)
            .border(1.dp, CrateColors.BorderHairline, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(modifier = Modifier.size(7.dp).clip(CircleShape).background(color))
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(13.dp))
        Text(
            text = label,
            style = CrateType.TabularMono,
            color = CrateColors.TextPrimary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun workspaceTitle(view: WorkspaceView): String = when (view) {
    WorkspaceView.DASHBOARD -> "Dashboard"
    WorkspaceView.SCANNER -> "Device Storage"
    WorkspaceView.PLAYLIST -> "Playlist Studio"
    WorkspaceView.SMART_PLAYLIST -> "Smart Playlist"
    WorkspaceView.SYNC -> "Sync Queue"
    WorkspaceView.SCAN_LOGS -> "Scan Logs"
    WorkspaceView.TRANSFER -> "Drive Sync & Transfer"
}
