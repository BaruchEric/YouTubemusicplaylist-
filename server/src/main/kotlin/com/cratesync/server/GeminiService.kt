package com.cratesync.server

import com.cratesync.core.CANONICAL_GENRES
import com.cratesync.core.normalizeCanonicalGenre
import com.cratesync.model.GenreClassification
import com.cratesync.model.GenreClassifyInput
import com.cratesync.model.GenreClassifyResponse
import com.cratesync.model.GroundingSource
import com.cratesync.model.MetadataLookupResponse
import com.cratesync.model.MetadataSuggestion
import com.cratesync.model.TrackLookupInput
import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

class GeminiServiceException(
    val statusCode: Int,
    override val message: String,
) : Exception(message)

/**
 * Server-side Gemini API integration using `gemini-4-hydrogen`.
 * Reads `GEMINI_API_KEY` exclusively from server environment variables.
 */
class GeminiService(
    private val httpClient: HttpClient,
    private val apiKeyProvider: () -> String? = { System.getenv("GEMINI_API_KEY") },
) {
    companion object {
        const val MODEL = "gemini-4-hydrogen"
        private const val GENERATE_URL =
            "https://generativelanguage.googleapis.com/v1beta/models/$MODEL:generateContent"
    }

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private fun requireApiKey(): String =
        apiKeyProvider()?.trim()?.takeIf { it.isNotEmpty() }
            ?: throw GeminiServiceException(
                503,
                "Server-side GEMINI_API_KEY is not configured. Configure it in your server environment or Settings > Secrets.",
            )

    suspend fun suggestMetadata(tracks: List<TrackLookupInput>): MetadataLookupResponse {
        val apiKey = requireApiKey()
        val prompt = buildString {
            appendLine("Identify the canonical recording metadata (title, artist, album, 4-digit release year) for each local music file.")
            appendLine("Use Google Search to verify artist credits, official release albums, and original release years.")
            appendLine("Preserve exact trackId values. If unsure on a field, leave it blank and set confidence to low.")
            appendLine()
            appendLine(json.encodeToString(tracks))
        }

        val requestBody = buildJsonObject {
            putJsonObject("systemInstruction") {
                putJsonArray("parts") {
                    add(buildJsonObject {
                        put(
                            "text",
                            "You are CrateSync's music discography archivist. Return strict JSON matching the schema with verified song titles, artists, albums, and release years.",
                        )
                    })
                }
            }
            putJsonArray("contents") {
                add(buildJsonObject {
                    put("role", "user")
                    putJsonArray("parts") {
                        add(buildJsonObject { put("text", prompt) })
                    }
                })
            }
            putJsonArray("tools") {
                add(buildJsonObject {
                    putJsonObject("google_search") {}
                })
            }
            putJsonObject("generationConfig") {
                put("responseMimeType", "application/json")
                putJsonObject("responseSchema") {
                    put("type", "OBJECT")
                    putJsonObject("properties") {
                        putJsonObject("suggestions") {
                            put("type", "ARRAY")
                            putJsonObject("items") {
                                put("type", "OBJECT")
                                putJsonObject("properties") {
                                    putJsonObject("trackId") { put("type", "STRING") }
                                    putJsonObject("title") { put("type", "STRING") }
                                    putJsonObject("artist") { put("type", "STRING") }
                                    putJsonObject("album") { put("type", "STRING") }
                                    putJsonObject("year") { put("type", "STRING") }
                                    putJsonObject("confidence") { put("type", "STRING") }
                                    putJsonObject("reason") { put("type", "STRING") }
                                }
                                putJsonArray("required") {
                                    add(JsonPrimitive("trackId"))
                                    add(JsonPrimitive("title"))
                                    add(JsonPrimitive("artist"))
                                    add(JsonPrimitive("album"))
                                    add(JsonPrimitive("year"))
                                    add(JsonPrimitive("confidence"))
                                }
                            }
                        }
                    }
                    putJsonArray("required") { add(JsonPrimitive("suggestions")) }
                }
            }
        }

        val root = callGemini(apiKey, requestBody)
        val rawText = extractCandidateText(root)
        val parsed = runCatching { json.decodeFromString<MetadataLookupResponse>(rawText) }
            .getOrElse { MetadataLookupResponse() }
        val sources = extractGroundingSources(root)
        val validIds = tracks.map { it.id }.toSet()
        return MetadataLookupResponse(
            suggestions = parsed.suggestions.filter { it.trackId in validIds },
            sources = sources,
        )
    }

    suspend fun classifyGenres(tracks: List<GenreClassifyInput>): GenreClassifyResponse {
        val apiKey = requireApiKey()
        val prompt = buildString {
            appendLine("Classify each track into exactly ONE canonical genre from this list:")
            appendLine(CANONICAL_GENRES.joinToString(", "))
            appendLine("Optionally include a concise subgenre (e.g. 'Deep House', 'Boom Bap', 'Post-Punk').")
            appendLine("Preserve exact trackId values.")
            appendLine()
            appendLine(json.encodeToString(tracks))
        }

        val requestBody = buildJsonObject {
            putJsonObject("systemInstruction") {
                putJsonArray("parts") {
                    add(buildJsonObject {
                        put(
                            "text",
                            "You are CrateSync's music genre classifier. Return strict JSON assigning one canonical genre per trackId.",
                        )
                    })
                }
            }
            putJsonArray("contents") {
                add(buildJsonObject {
                    put("role", "user")
                    putJsonArray("parts") {
                        add(buildJsonObject { put("text", prompt) })
                    }
                })
            }
            putJsonObject("generationConfig") {
                put("responseMimeType", "application/json")
                putJsonObject("thinkingConfig") {
                    put("thinkingLevel", "LOW")
                }
                putJsonObject("responseSchema") {
                    put("type", "OBJECT")
                    putJsonObject("properties") {
                        putJsonObject("classifications") {
                            put("type", "ARRAY")
                            putJsonObject("items") {
                                put("type", "OBJECT")
                                putJsonObject("properties") {
                                    putJsonObject("trackId") { put("type", "STRING") }
                                    putJsonObject("genre") {
                                        put("type", "STRING")
                                        put("enum", buildJsonArray { CANONICAL_GENRES.forEach { add(JsonPrimitive(it)) } })
                                    }
                                    putJsonObject("subgenre") { put("type", "STRING") }
                                    putJsonObject("confidence") { put("type", "STRING") }
                                }
                                putJsonArray("required") {
                                    add(JsonPrimitive("trackId"))
                                    add(JsonPrimitive("genre"))
                                    add(JsonPrimitive("confidence"))
                                }
                            }
                        }
                    }
                    putJsonArray("required") { add(JsonPrimitive("classifications")) }
                }
            }
        }

        val root = callGemini(apiKey, requestBody)
        val rawText = extractCandidateText(root)
        val parsed = runCatching { json.decodeFromString<GenreClassifyResponse>(rawText) }
            .getOrElse { GenreClassifyResponse() }
        val validIds = tracks.map { it.id }.toSet()
        val normalized = parsed.classifications
            .filter { it.trackId in validIds }
            .map { item ->
                GenreClassification(
                    trackId = item.trackId,
                    genre = normalizeCanonicalGenre(item.genre) ?: "Electronic",
                    subgenre = item.subgenre.trim(),
                    confidence = item.confidence.lowercase().ifBlank { "medium" },
                )
            }
        return GenreClassifyResponse(classifications = normalized)
    }

    private suspend fun callGemini(apiKey: String, payload: JsonObject): JsonObject {
        val resp = httpClient.post(GENERATE_URL) {
            header("x-goog-api-key", apiKey)
            header(HttpHeaders.UserAgent, "aistudio-build")
            contentType(ContentType.Application.Json)
            setBody(payload.toString())
        }
        val text = resp.bodyAsText()
        if (!resp.status.isSuccess()) {
            val message = runCatching {
                json.parseToJsonElement(text).jsonObject["error"]?.jsonObject?.get("message")?.jsonPrimitive?.contentOrNull
            }.getOrNull() ?: "Gemini API request failed (${resp.status.value})."
            throw GeminiServiceException(resp.status.value, message)
        }
        return json.parseToJsonElement(text).jsonObject
    }

    private fun extractCandidateText(root: JsonObject): String {
        val parts = root["candidates"]?.jsonArray
            ?.firstOrNull()?.jsonObject
            ?.get("content")?.jsonObject
            ?.get("parts")?.jsonArray
            ?: JsonArray(emptyList())
        return parts.mapNotNull { it.jsonObject["text"]?.jsonPrimitive?.contentOrNull }.joinToString("").trim()
    }

    private fun extractGroundingSources(root: JsonObject): List<GroundingSource> {
        val chunks = root["candidates"]?.jsonArray
            ?.firstOrNull()?.jsonObject
            ?.get("groundingMetadata")?.jsonObject
            ?.get("groundingChunks")?.jsonArray
            ?: return emptyList()
        return chunks.mapNotNull { el ->
            val web = el.jsonObject["web"]?.jsonObject ?: return@mapNotNull null
            val uri = web["uri"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val title = web["title"]?.jsonPrimitive?.contentOrNull ?: uri
            GroundingSource(title = title, uri = uri)
        }.distinctBy { it.uri }
    }
}
