package com.cratesync.server

import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.jwk.source.JWKSourceBuilder
import com.nimbusds.jose.proc.JWSVerificationKeySelector
import com.nimbusds.jose.proc.SecurityContext
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.proc.DefaultJWTClaimsVerifier
import com.nimbusds.jwt.proc.DefaultJWTProcessor
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

data class AuthenticatedAccount(
    val uid: String,
    val email: String?,
)

sealed class AuthGuardResult {
    data class Allowed(val account: AuthenticatedAccount, val releaseSlot: () -> Unit) : AuthGuardResult()
    data class Rejected(val statusCode: Int, val message: String, val retryAfterSeconds: Long? = null) : AuthGuardResult()
}

/**
 * Verifies Google-issued Firebase ID JWTs via Google's official JWKS endpoint, enforces
 * optional `GEMINI_ALLOWED_EMAILS`, and applies per-account rate limiting
 * (240 requests / 10 min + max 2 concurrent in-flight requests).
 */
class FirebaseAuthGuard(
    private val projectId: String = resolveFirebaseProjectId(),
    private val allowedEmails: Set<String> = parseAllowedEmails(System.getenv("GEMINI_ALLOWED_EMAILS")),
    private val maxRequestsPerWindow: Int = 240,
    private val windowMs: Long = 10L * 60L * 1000L,
    private val maxConcurrentPerAccount: Int = 2,
) {
    private val issuer = "https://securetoken.google.com/$projectId"

    private val jwtProcessor: DefaultJWTProcessor<SecurityContext> by lazy {
        val jwkSource = JWKSourceBuilder
            .create<SecurityContext>(
                URI("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com").toURL()
            )
            .retrying(true)
            .build()
        val keySelector = JWSVerificationKeySelector(JWSAlgorithm.RS256, jwkSource)
        DefaultJWTProcessor<SecurityContext>().apply {
            jwsKeySelector = keySelector
            jwtClaimsSetVerifier = DefaultJWTClaimsVerifier(
                setOf(projectId),
                JWTClaimsSet.Builder().issuer(issuer).build(),
                setOf("sub", "iat", "exp", "auth_time"),
                null,
            )
        }
    }

    private class AccountBucket {
        val timestamps = ArrayDeque<Long>()
        val inFlight = AtomicInteger(0)
    }

    private val buckets = ConcurrentHashMap<String, AccountBucket>()

    fun verifyAndAcquire(authorizationHeader: String?): AuthGuardResult {
        val rawToken = authorizationHeader
            ?.takeIf { it.startsWith("Bearer ", ignoreCase = true) }
            ?.substring(7)
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: return AuthGuardResult.Rejected(401, "Missing Bearer Firebase ID token.")

        val claims = try {
            jwtProcessor.process(rawToken, null)
        } catch (e: Exception) {
            return AuthGuardResult.Rejected(401, "Invalid or expired Firebase ID token.")
        }

        val uid = claims.subject?.trim().orEmpty()
        if (uid.isEmpty()) {
            return AuthGuardResult.Rejected(401, "Firebase ID token missing subject.")
        }

        val email = claims.getStringClaim("email")?.trim()?.lowercase()
        val emailVerified = claims.getBooleanClaim("email_verified") == true
        if (allowedEmails.isNotEmpty()) {
            if (email.isNullOrBlank() || !emailVerified || email !in allowedEmails) {
                return AuthGuardResult.Rejected(403, "This account is not authorized to access AI enrichment endpoints.")
            }
        }

        val bucket = buckets.computeIfAbsent(uid) { AccountBucket() }
        val now = System.currentTimeMillis()
        synchronized(bucket) {
            while (bucket.timestamps.isNotEmpty() && now - bucket.timestamps.first() >= windowMs) {
                bucket.timestamps.removeFirst()
            }
            if (bucket.timestamps.size >= maxRequestsPerWindow) {
                val oldest = bucket.timestamps.first()
                val retryAfterSec = (((oldest + windowMs) - now) / 1000L).coerceAtLeast(1L)
                return AuthGuardResult.Rejected(
                    statusCode = 429,
                    message = "Rate limit exceeded (240 requests per 10 minutes).",
                    retryAfterSeconds = retryAfterSec,
                )
            }
            if (bucket.inFlight.get() >= maxConcurrentPerAccount) {
                return AuthGuardResult.Rejected(
                    statusCode = 429,
                    message = "Too many concurrent AI requests for this account (max 2 in flight).",
                    retryAfterSeconds = 2L,
                )
            }
            bucket.timestamps.addLast(now)
            bucket.inFlight.incrementAndGet()
        }

        var released = false
        return AuthGuardResult.Allowed(
            account = AuthenticatedAccount(uid = uid, email = email),
            releaseSlot = {
                synchronized(bucket) {
                    if (!released) {
                        released = true
                        bucket.inFlight.decrementAndGet()
                    }
                }
            },
        )
    }

    companion object {
        fun parseAllowedEmails(raw: String?): Set<String> =
            raw.orEmpty()
                .split(',', ';', '\n')
                .map { it.trim().lowercase() }
                .filter { it.isNotEmpty() }
                .toSet()

        fun resolveFirebaseProjectId(): String {
            System.getenv("FIREBASE_PROJECT_ID")?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
            val candidates = listOf(File("firebase-applet-config.json"), File("../firebase-applet-config.json"))
            for (file in candidates) {
                if (file.exists()) {
                    runCatching {
                        val obj = Json.parseToJsonElement(file.readText()).jsonObject
                        obj["projectId"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }?.let { return it }
                    }
                }
            }
            return "gen-lang-client-0484635733"
        }
    }
}
