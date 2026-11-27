package com.cratesync.core

import com.cratesync.model.DeviceFolderBinding
import com.cratesync.model.DriveFolderMapping
import com.cratesync.model.FolderMappingTombstone
import com.cratesync.model.FolderSyncDirection
import com.cratesync.model.LocalTrack
import com.cratesync.model.SyncDeviceProfile
import kotlin.math.max

data class FolderMappingState(
    val folderMappings: List<DriveFolderMapping>,
    val folderMappingTombstones: List<FolderMappingTombstone>,
)

/**
 * Normalizes cross-platform folder paths, binds Drive folders to per-device local paths,
 * and merges multi-device mappings with 365-day deletion tombstones.
 */
object FolderMappingMerge {
    const val TOMBSTONE_TTL_MS = 365L * 24 * 60 * 60 * 1000

    fun normalizeFolderPath(rawPath: String): String =
        rawPath.trim()
            .replace('\\', '/')
            .trim('/')
            .replace(Regex("/{2,}"), "/")

    fun trackMatchesLocalFolder(track: LocalTrack, localFolderPath: String): Boolean {
        val target = normalizeFolderPath(localFolderPath).lowercase()
        if (target.isEmpty()) return false
        val trackFolder = normalizeFolderPath(track.folderName).lowercase()
        val trackRel = normalizeFolderPath(track.relativePath).lowercase()
        if (trackFolder == target || trackRel == target || trackRel.startsWith("$target/")) return true
        val lastSeg = target.substringAfterLast('/')
        return lastSeg.isNotEmpty() && trackFolder == lastSeg
    }

    fun translateRelativePathForDevice(
        fileName: String,
        localFolderPath: String,
        fallbackDriveFolderName: String,
    ): Pair<String, String> {
        val normLocal = normalizeFolderPath(localFolderPath)
        if (normLocal.isNotEmpty()) {
            val leaf = normLocal.substringAfterLast('/')
            return leaf to "$normLocal/$fileName"
        }
        val cleanDrive = normalizeFolderPath(fallbackDriveFolderName).ifEmpty { "Google Drive" }
        return cleanDrive to "$cleanDrive/$fileName"
    }

    fun resolveDriveMappingForLocalTrack(
        track: LocalTrack,
        mappings: List<DriveFolderMapping>,
        deviceId: String,
    ): Pair<DriveFolderMapping, DeviceFolderBinding>? {
        var best: Triple<DriveFolderMapping, DeviceFolderBinding, Int>? = null
        for (mapping in mappings) {
            val binding = mapping.deviceBindings[deviceId] ?: continue
            if (binding.syncDirection == FolderSyncDirection.PULL || binding.localFolderPath.isBlank()) continue
            if (trackMatchesLocalFolder(track, binding.localFolderPath)) {
                val specificity = normalizeFolderPath(binding.localFolderPath).length
                if (best == null || specificity > best.third) {
                    best = Triple(mapping, binding, specificity)
                }
            }
        }
        return best?.let { it.first to it.second }
    }

    fun mergeDeviceProfiles(
        localDevices: List<SyncDeviceProfile>,
        remoteDevices: List<SyncDeviceProfile>,
        currentDevice: SyncDeviceProfile,
    ): List<SyncDeviceProfile> {
        val byId = LinkedHashMap<String, SyncDeviceProfile>()
        for (dev in remoteDevices) byId[dev.id] = dev
        for (dev in localDevices) {
            val prev = byId[dev.id]
            if (prev == null || dev.lastSeenAt >= prev.lastSeenAt) byId[dev.id] = dev
        }
        byId[currentDevice.id] = currentDevice
        return byId.values.sortedWith(
            compareByDescending<SyncDeviceProfile> { it.id == currentDevice.id }
                .thenByDescending { it.lastSeenAt }
        )
    }

    private fun tombstoneKey(driveFolderId: String, deviceId: String?): String =
        "$driveFolderId::${deviceId ?: "*"}"

    fun mergeFolderMappingTombstones(
        lists: List<List<FolderMappingTombstone>>,
        now: Long,
    ): List<FolderMappingTombstone> {
        val byKey = LinkedHashMap<String, FolderMappingTombstone>()
        for (list in lists) {
            for (t in list) {
                if (t.driveFolderId.isBlank() || now - t.deletedAt > TOMBSTONE_TTL_MS) continue
                val key = tombstoneKey(t.driveFolderId, t.deviceId)
                val prev = byKey[key]
                if (prev == null || t.deletedAt > prev.deletedAt) byKey[key] = t
            }
        }
        return byKey.values.sortedByDescending { it.deletedAt }
    }

    fun mergeFolderMappings(
        localMappings: List<DriveFolderMapping>,
        remoteMappings: List<DriveFolderMapping>,
        preferRemoteForConflicts: Boolean = true,
        localDeviceId: String? = null,
    ): List<DriveFolderMapping> {
        val ownLocalBindings = mutableMapOf<String, DeviceFolderBinding>()
        if (!localDeviceId.isNullOrBlank()) {
            for (m in localMappings) {
                val own = m.deviceBindings[localDeviceId]
                if (own != null) ownLocalBindings[m.driveFolderId] = own
            }
        }

        val seed = if (preferRemoteForConflicts) localMappings else remoteMappings
        val overlay = if (preferRemoteForConflicts) remoteMappings else localMappings
        val byId = LinkedHashMap<String, DriveFolderMapping>()

        for (m in seed) byId[m.driveFolderId] = m
        for (incoming in overlay) {
            val existing = byId[incoming.driveFolderId]
            if (existing == null) {
                byId[incoming.driveFolderId] = incoming
            } else {
                val mergedBindings = existing.deviceBindings.toMutableMap()
                for ((devId, binding) in incoming.deviceBindings) {
                    if (devId == localDeviceId && ownLocalBindings.containsKey(incoming.driveFolderId)) {
                        mergedBindings[devId] = ownLocalBindings[incoming.driveFolderId]!!
                        continue
                    }
                    val prev = mergedBindings[devId]
                    if (prev == null || preferRemoteForConflicts || (binding.lastSyncedAt ?: 0L) >= (prev.lastSyncedAt ?: 0L)) {
                        mergedBindings[devId] = binding
                    }
                }
                byId[incoming.driveFolderId] = existing.copy(
                    driveFolderName = incoming.driveFolderName.ifBlank { existing.driveFolderName },
                    updatedAt = max(existing.updatedAt, incoming.updatedAt),
                    deviceBindings = mergedBindings,
                )
            }
        }
        return byId.values.sortedByDescending { it.updatedAt }
    }

    fun applyFolderMappingTombstones(
        mappings: List<DriveFolderMapping>,
        tombstones: List<FolderMappingTombstone>,
    ): List<DriveFolderMapping> {
        if (tombstones.isEmpty()) return mappings
        val deletedAt = tombstones.associate { tombstoneKey(it.driveFolderId, it.deviceId) to it.deletedAt }
        return buildList {
            for (mapping in mappings) {
                val wholeDeleted = deletedAt[tombstoneKey(mapping.driveFolderId, null)]
                val kept = LinkedHashMap<String, DeviceFolderBinding>()
                for ((devId, binding) in mapping.deviceBindings) {
                    val bTime = binding.updatedAt ?: 0L
                    val devDeleted = deletedAt[tombstoneKey(mapping.driveFolderId, devId)]
                    val covered = (wholeDeleted != null && bTime <= wholeDeleted) ||
                        (devDeleted != null && bTime <= devDeleted)
                    if (!covered) kept[devId] = binding
                }
                if (kept.isNotEmpty()) add(mapping.copy(deviceBindings = kept))
            }
        }
    }

    fun mergeFolderMappingState(
        local: FolderMappingState,
        remote: FolderMappingState,
        localDeviceId: String,
        now: Long,
    ): FolderMappingState {
        val tombstones = mergeFolderMappingTombstones(
            listOf(local.folderMappingTombstones, remote.folderMappingTombstones),
            now,
        )
        val merged = mergeFolderMappings(local.folderMappings, remote.folderMappings, true, localDeviceId)
        return FolderMappingState(
            folderMappings = applyFolderMappingTombstones(merged, tombstones),
            folderMappingTombstones = tombstones,
        )
    }
}
