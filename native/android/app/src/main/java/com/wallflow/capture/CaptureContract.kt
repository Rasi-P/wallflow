package com.wallflow.capture

import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID

internal const val CAPTURE_PATH = "/capture/native/android"
internal const val CALLBACK_PATH = "/auth/native/android/callback"

internal fun pkceVerifier(): String = ByteArray(32).also(SecureRandom()::nextBytes).let {
    Base64.getUrlEncoder().withoutPadding().encodeToString(it)
}

internal fun pkceChallenge(verifier: String): String = Base64.getUrlEncoder().withoutPadding()
    .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.UTF_8)))

internal fun acceptsLink(uri: URI, host: String, path: String): Boolean =
    host.isNotEmpty() && uri.scheme == "https" && uri.host.equals(host, ignoreCase = true) &&
        uri.port == -1 && uri.rawUserInfo == null && uri.rawFragment == null && uri.rawPath == path

internal data class Capture(
    val id: String, val project: String, val owner: String, val content: String,
    val board: String?, val checklist: List<String>, val failure: String? = null,
) {
    fun belongsTo(project: String, owner: String) = this.project == project && this.owner == owner

    companion object {
        fun create(project: String, owner: String, content: String, board: String?, checklist: String): Capture {
            val note = content.trim()
            val items = checklist.lineSequence().map(String::trim).filter(String::isNotEmpty).toList()
            require((note.isNotEmpty() || items.isNotEmpty()) && note.length <= 240 &&
                items.size <= 24 && items.all { it.length <= 120 }) {
                "Enter up to 240 characters and up to 24 checklist items of 120 characters each."
            }
            return Capture(UUID.randomUUID().toString(), project, owner, note, board, items)
        }
    }
}

internal enum class WidgetStatus(val label: String) {
    SIGN_IN("Sign in to capture"), READY("Ready for a note"), SYNCING("Syncing…"),
    OFFLINE("Pending connection"), FAILED("Open to retry"), SAVED("Last capture synced");
}
