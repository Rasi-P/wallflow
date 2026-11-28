package com.wallflow.capture

import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

internal data class Board(val id: String, val name: String)
internal data class Workspace(val active: String, val boards: List<Board>)

internal data class Session(
    val project: String, val owner: String, val access: String, val refresh: String, val expires: Long,
) {
    fun serialize() = JSONObject().put("project", project).put("owner", owner).put("access", access)
        .put("refresh", refresh).put("expires", expires).toString()

    companion object {
        fun restore(value: String) = JSONObject(value).let {
            Session(it.getString("project"), it.getString("owner"), it.getString("access"),
                it.getString("refresh"), it.getLong("expires"))
        }
    }
}

internal class ApiFailure(val status: Int, val detail: String) : Exception() {
    val retryable get() = status == 429 || status >= 500
    val auth get() = status == 401 || status == 403 || detail == "42501"
    fun captureMessage() = when (detail) {
        "board_full" -> "This board has 60 active notes. Archive a note and retry."
        "board_unavailable" -> "The selected board is unavailable."
        "capture_conflict" -> "This capture request ID was already used."
        else -> "WALLFLOW couldn’t sync this capture."
    }
}

internal class Supabase(private val project: String, private val key: String, private val host: String) {
    val configured = project.isNotEmpty() && key.startsWith("sb_publishable_") && host.isNotEmpty()

    fun authorization(verifier: String): Uri = Uri.parse("$project/auth/v1/authorize").buildUpon()
        .appendQueryParameter("provider", "google")
        .appendQueryParameter("prompt", "select_account")
        .appendQueryParameter("redirect_to", "https://$host$CALLBACK_PATH")
        .appendQueryParameter("code_challenge", pkceChallenge(verifier))
        .appendQueryParameter("code_challenge_method", "s256").build()

    fun exchange(code: String, verifier: String) = token("pkce", JSONObject()
        .put("auth_code", code).put("code_verifier", verifier))

    fun refresh(session: Session): Session {
        val next = token("refresh_token", JSONObject().put("refresh_token", session.refresh))
        if (next.owner != session.owner) throw ApiFailure(401, "wrong_owner")
        return next
    }

    private fun token(grant: String, body: JSONObject): Session {
        val value = request("/auth/v1/token?grant_type=$grant", data = body) as JSONObject
        val type = value.getString("token_type")
        if (!type.equals("bearer", ignoreCase = true)) throw IOException("Invalid session response")
        val lifetime = value.getLong("expires_in")
        val access = value.getString("access_token")
        val refresh = value.getString("refresh_token")
        if (lifetime <= 0 || access.isBlank() || refresh.isBlank()) throw IOException("Invalid session response")
        return Session(project, value.getJSONObject("user").getString("id"), access, refresh,
            System.currentTimeMillis() / 1000 + lifetime)
    }

    fun verify(session: Session) {
        val user = request("/auth/v1/user", session) as JSONObject
        if (user.optString("id") != session.owner) throw ApiFailure(401, "wrong_owner")
        val id = rpc("initialize_wallflow_workspace", session) as? String
        if (id.isNullOrBlank()) throw IOException("Workspace is unavailable")
    }

    fun workspace(session: Session): Workspace {
        val value = rpc("read_wallflow_workspace_preview", session) as? JSONObject
            ?: throw ApiFailure(403, "workspace_unavailable")
        val array = value.getJSONArray("boards")
        val boards = (0 until array.length()).map {
            val board = array.getJSONObject(it)
            Board(board.getString("id"), board.getString("name"))
        }
        val active = value.getString("activeBoardId")
        if (boards.none { it.id == active }) throw IOException("Invalid board response")
        return Workspace(active, boards)
    }

    fun capture(session: Session, note: Capture): Boolean {
        check(note.belongsTo(project, session.owner))
        val data = JSONObject().put("operation_id", note.id).put("content", note.content)
            .put("board_id", note.board ?: JSONObject.NULL)
        if (note.checklist.isNotEmpty()) data.put("checklist", JSONArray(note.checklist))
        val receipt = rpc("quick_capture_wallflow_note", session, data) as JSONObject
        val id = receipt.getString("noteId")
        if (id.isBlank() || !receipt.getString("revision").matches(Regex("[0-9]+")) ||
            !receipt.has("note") || (!receipt.isNull("note") && receipt.getJSONObject("note").getString("id") != id)) {
            throw IOException("Invalid receipt")
        }
        return !receipt.isNull("note")
    }

    fun logout(session: Session) { request("/auth/v1/logout?scope=local", session, JSONObject()) }

    private fun rpc(name: String, session: Session, body: JSONObject = JSONObject()): Any? =
        request("/rest/v1/rpc/$name", session, body.put("expected_owner_id", session.owner))

    private fun request(path: String, session: Session? = null, data: JSONObject? = null): Any? {
        check(configured && (session == null || session.project == project))
        val connection = URL(project + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 12_000
            connection.readTimeout = 12_000
            connection.useCaches = false
            connection.setRequestProperty("apikey", key)
            connection.setRequestProperty("Accept", "application/json")
            if (session != null) connection.setRequestProperty("Authorization", "Bearer ${session.access}")
            if (data != null) {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(data.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            if (code !in 200..299) {
                val error = runCatching { JSONObject(connection.errorStream?.use { it.let { stream ->
                    val buffer = ByteArray(16_384)
                    val count = stream.read(buffer)
                    if (count > 0) buffer.copyOf(count) else ByteArray(0)
                } }
                    ?.toString(Charsets.UTF_8).orEmpty()) }.getOrNull()
                throw ApiFailure(code, error?.optString("details")?.takeIf { it.isNotEmpty() }
                    ?: error?.optString("code").orEmpty())
            }
            if (code == 204) return null
            val bytes = connection.inputStream.use { input ->
                val buffer = ByteArray(8192)
                val output = java.io.ByteArrayOutputStream()
                var size = input.read(buffer)
                while (size >= 0) {
                    if (output.size() + size > 8_000_000) throw IOException("Response too large")
                    output.write(buffer, 0, size)
                    size = input.read(buffer)
                }
                output.toByteArray()
            }
            return JSONTokener(bytes.toString(Charsets.UTF_8)).nextValue()
        } finally { connection.disconnect() }
    }
}
