package com.cratesync.server

import com.cratesync.model.ApiErrorResponse
import com.cratesync.model.GenreClassifyRequest
import com.cratesync.model.MetadataLookupRequest
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.receive
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
private data class HealthResponse(
    val status: String,
    val service: String,
    val model: String,
)

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 3000
    val host = System.getenv("BIND_HOST")?.takeIf { it.isNotBlank() } ?: "0.0.0.0"
    embeddedServer(Netty, port = port, host = host, module = Application::crateSyncServerModule)
        .start(wait = true)
}

fun Application.crateSyncServerModule(
    authGuard: FirebaseAuthGuard = FirebaseAuthGuard(),
    geminiService: GeminiService = GeminiService(HttpClient(CIO)),
) {
    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true; encodeDefaults = true })
    }

    install(CORS) {
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowMethod(HttpMethod.Options)
        allowHeader(HttpHeaders.Authorization)
        allowHeader(HttpHeaders.ContentType)
        exposeHeader(HttpHeaders.RetryAfter)
        anyHost()
    }

    install(StatusPages) {
        exception<GeminiServiceException> { call, cause ->
            val status = HttpStatusCode.fromValue(cause.statusCode.coerceIn(400, 599))
            call.respond(status, ApiErrorResponse(cause.message))
        }
        exception<IllegalArgumentException> { call, cause ->
            call.respond(HttpStatusCode.BadRequest, ApiErrorResponse(cause.message ?: "Invalid request payload."))
        }
        exception<Throwable> { call, cause ->
            call.respond(
                HttpStatusCode.InternalServerError,
                ApiErrorResponse(cause.message ?: "Unexpected server error."),
            )
        }
    }

    routing {
        get("/api/health") {
            call.respond(
                HealthResponse(
                    status = "ok",
                    service = "cratesync-kmp-server",
                    model = GeminiService.MODEL,
                )
            )
        }

        post("/api/metadata/suggest") {
            // Authenticate and rate-limit strictly BEFORE parsing the request body
            val guard = authGuard.verifyAndAcquire(call.request.headers[HttpHeaders.Authorization])
            when (guard) {
                is AuthGuardResult.Rejected -> {
                    guard.retryAfterSeconds?.let { call.response.header(HttpHeaders.RetryAfter, it.toString()) }
                    call.respond(HttpStatusCode.fromValue(guard.statusCode), ApiErrorResponse(guard.message))
                    return@post
                }
                is AuthGuardResult.Allowed -> {
                    try {
                        val req = call.receive<MetadataLookupRequest>()
                        if (req.tracks.isEmpty() || req.tracks.size > 25) {
                            call.respond(
                                HttpStatusCode.BadRequest,
                                ApiErrorResponse("tracks must contain between 1 and 25 items."),
                            )
                            return@post
                        }
                        val response = geminiService.suggestMetadata(req.tracks)
                        call.respond(HttpStatusCode.OK, response)
                    } finally {
                        guard.releaseSlot()
                    }
                }
            }
        }

        post("/api/genres/classify") {
            // Authenticate and rate-limit strictly BEFORE parsing the request body
            val guard = authGuard.verifyAndAcquire(call.request.headers[HttpHeaders.Authorization])
            when (guard) {
                is AuthGuardResult.Rejected -> {
                    guard.retryAfterSeconds?.let { call.response.header(HttpHeaders.RetryAfter, it.toString()) }
                    call.respond(HttpStatusCode.fromValue(guard.statusCode), ApiErrorResponse(guard.message))
                    return@post
                }
                is AuthGuardResult.Allowed -> {
                    try {
                        val req = call.receive<GenreClassifyRequest>()
                        if (req.tracks.isEmpty() || req.tracks.size > 60) {
                            call.respond(
                                HttpStatusCode.BadRequest,
                                ApiErrorResponse("tracks must contain between 1 and 60 items."),
                            )
                            return@post
                        }
                        val response = geminiService.classifyGenres(req.tracks)
                        call.respond(HttpStatusCode.OK, response)
                    } finally {
                        guard.releaseSlot()
                    }
                }
            }
        }
    }
}
