package com.cratesync.model

import kotlinx.serialization.Serializable

@Serializable
data class TrackLookupInput(
    val id: String,
    val fileName: String,
    val relativePath: String,
    val folderName: String,
    val title: String,
    val artist: String,
    val album: String,
    val year: String,
    val duration: Double = 0.0,
)

@Serializable
data class MetadataLookupRequest(
    val tracks: List<TrackLookupInput>,
)

@Serializable
data class MetadataSuggestion(
    val trackId: String,
    val title: String = "",
    val artist: String = "",
    val album: String = "",
    val year: String = "",
    val confidence: String = "medium",
    val reason: String = "",
)

@Serializable
data class GroundingSource(
    val title: String,
    val uri: String,
)

@Serializable
data class MetadataLookupResponse(
    val suggestions: List<MetadataSuggestion> = emptyList(),
    val sources: List<GroundingSource> = emptyList(),
)

@Serializable
data class GenreClassifyInput(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val fileName: String,
    val relativePath: String,
    val folderName: String,
    val year: String,
    val duration: Double = 0.0,
    val currentGenre: String = "",
)

@Serializable
data class GenreClassifyRequest(
    val tracks: List<GenreClassifyInput>,
)

@Serializable
data class GenreClassification(
    val trackId: String,
    val genre: String,
    val subgenre: String = "",
    val confidence: String = "medium",
)

@Serializable
data class GenreClassifyResponse(
    val classifications: List<GenreClassification> = emptyList(),
)

@Serializable
data class ApiErrorResponse(
    val error: String,
)
