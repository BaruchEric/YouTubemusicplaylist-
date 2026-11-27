package com.cratesync.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cratesync.model.DriveFolderMapping
import com.cratesync.model.SyncDeviceProfile
import com.cratesync.platform.AuthUserProfile
import com.cratesync.ui.theme.CrateColors
import com.cratesync.ui.theme.CrateType
import com.cratesync.ui.theme.StudioPanel

@Composable
fun DriveTransferScreen(
    user: AuthUserProfile?,
    currentDevice: SyncDeviceProfile,
    knownDevices: List<SyncDeviceProfile>,
    folderMappings: List<DriveFolderMapping>,
    trackCount: Int,
    onSignInDrive: () -> Unit,
    onSignOut: () -> Unit,
    onOpenDriveBrowser: () -> Unit,
    onPushManifest: () -> Unit,
    onRemoveMapping: (DriveFolderMapping) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        StudioPanel(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Google Drive Multi-Device Source of Truth", style = CrateType.SectionTitle)
                    Text(
                        if (user != null) "Signed in as ${user.email} · In-memory least-privilege OAuth token"
                        else "Connect Google Drive (drive.readonly + drive.file) to sync cratesync-source-of-truth.json and audio folders.",
                        fontSize = 12.sp,
                        color = CrateColors.TextSecondary,
                    )
                    Text("This device: ${currentDevice.name} (${currentDevice.platform}) · ${knownDevices.size} synced devices", style = CrateType.TabularMono)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (user == null) {
                        Button(onClick = onSignInDrive, colors = ButtonDefaults.buttonColors(containerColor = CrateColors.Accent)) {
                            Text("Sign in with Google")
                        }
                    } else {
                        OutlinedButton(onClick = onOpenDriveBrowser) { Text("Browse Drive Folders") }
                        Button(onClick = onPushManifest, colors = ButtonDefaults.buttonColors(containerColor = CrateColors.Accent)) {
                            Text("Merge & Push ($trackCount)")
                        }
                        TextButton(onClick = onSignOut) { Text("Sign Out", color = CrateColors.TextSecondary) }
                    }
                }
            }
        }

        StudioPanel(modifier = Modifier.weight(1f).fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column {
                        Text("Per-Device Drive Folder Mappings (${folderMappings.size})", style = CrateType.SectionTitle)
                        Text("Map each Google Drive music folder to a local path on Android, iOS, Desktop, or Web with 365-day deletion tombstones.", fontSize = 12.sp, color = CrateColors.TextSecondary)
                    }
                    OutlinedButton(onClick = onOpenDriveBrowser) { Text("Add Folder Mapping") }
                }
                if (folderMappings.isEmpty()) {
                    Text("No folder mappings configured yet.", fontSize = 12.sp, color = CrateColors.TextMuted)
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(folderMappings, key = { it.driveFolderId }) { mapping ->
                            val own = mapping.deviceBindings[currentDevice.id]
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column {
                                    Text(mapping.driveFolderName, color = CrateColors.TextPrimary, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                                    Text(
                                        "Local: ${own?.localFolderPath?.ifBlank { "Offline Cache Only" } ?: "Unbound on this device"} · ${own?.syncDirection?.name ?: "—"} · ${mapping.deviceBindings.size} devices",
                                        style = CrateType.TabularMono,
                                    )
                                }
                                TextButton(onClick = { onRemoveMapping(mapping) }) {
                                    Text("Remove", color = CrateColors.CrimsonError, fontSize = 12.sp)
                                }
                            }
                            HorizontalDivider(color = CrateColors.BorderHairline)
                        }
                    }
                }
            }
        }
    }
}
