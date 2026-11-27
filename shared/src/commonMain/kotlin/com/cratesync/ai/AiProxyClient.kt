package com.cratesync.ai

import com.cratesync.model.ApiErrorResponse
import com.cratesync.model.GenreClassifyInput
import com.cratesync.model.GenreClassifyRequest
import com.cratesync.model.GenreClassifyResponse
import com.cratesync.model.MetadataLookupRequest
import com.cratesync.model.MetadataLookupResponse
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
import kotlinx.coroutines.delay
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Authenticated Ktor client for CrateSync's server-side Gemini AI proxy endpoints.
 * Attaches the user's Firebase ID token as Bearer auth and retries 429 Retry-After cleanly.
 */
class AiProxyClient(
    private val httpClient: HttpClient,
    private val baseUrlProvider: () -> String,
    private val firebaseIdTokenProvider: suspend () -> String?,
) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    suspend fun suggestMetadata(tracks: List<TrackLookupInput>): MetadataLookupResponse {
        require(tracks.isNotEmpty() && tracks.size <= 25) { "Batch must contain 1..25 tracks." }
        val payload = json.encodeToString(MetadataLookupRequest(tracks))
        val text = postWithRetry("/api/metadata/suggest", payload)
        return json.decodeFromString(text)
    }

    suspend fun classifyGenres(tracks: List<GenreClassifyInput>): GenreClassifyResponse {
        require(tracks.isNotEmpty() && tracks.size <= 60) { "Batch must contain 1..60 tracks." }
        val payload = json.encodeToString(GenreClassifyRequest(tracks))
        val text = postWithRetry("/api/genres/classify", payload)
        return json.decodeFromString(text)
    }

    private suspend fun postWithRetry(path: String, jsonBody: String): String {
        val token = firebaseIdTokenProvider()?.takeIf { it.isNotBlank() }
            ?: error("Sign in with your Google account to use AI metadata and genre enrichment.")
        val url = "${baseUrlProvider().trimEnd('/')}$path"

        repeat(2) { attempt ->
            val resp = httpClient.post(url) {
                header(HttpHeaders.Authorization, "Bearer $token")
                contentType(ContentType.Application.Json)
                setBody(jsonBody)
            }
            val body = resp.bodyAsText()
            if (resp.status.isSuccess()) return body
            if (resp.status.value == 429 && attempt == 0) {
                val retryAfterSec = resp.headers[HttpHeaders.RetryAfter]?.toLongOrNull()?.coerceIn(1L, 15L) ?: 3L
                delay(retryAfterSec * 1000L)
                return@repeat
            }
            val msg = runCatching { json.decodeFromString<ApiErrorResponse>(body).error }.getOrNull()
                ?: "AI request failed (${resp.status.value})."
            error(msg)
        }
        error("AI service rate limit exceeded. Please try again shortly.")
    }
}
