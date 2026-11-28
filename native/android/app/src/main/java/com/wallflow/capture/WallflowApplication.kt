package com.wallflow.capture

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URI
import java.util.concurrent.Executors

internal data class ScreenState(
    val configured: Boolean,
    val account: String? = null,
    val workspace: Workspace? = null,
    val pending: List<Capture> = emptyList(),
    val working: Boolean = false,
    val message: String = "",
)

class WallflowApplication : Application() {
    internal val project = BuildConfig.SUPABASE_URL
    internal val host = BuildConfig.WEB_HOST
    private val backend by lazy { Supabase(project, BuildConfig.SUPABASE_KEY, host) }
    private val vault by lazy { Vault(this) }
    private val background = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private val listeners = mutableSetOf<(ScreenState) -> Unit>()
    private var state = ScreenState(false, working = true, message = "Opening WALLFLOW…")

    internal fun observe(listener: (ScreenState) -> Unit): () -> Unit {
        listeners.add(listener)
        listener(state)
        return { listeners.remove(listener) }
    }

    private fun view(next: ScreenState) = handler.post {
        state = next
        listeners.toList().forEach { it(next) }
    }

    private fun online(): Boolean {
        val network = getSystemService(ConnectivityManager::class.java)
        return network.activeNetwork != null
    }

    private fun session(): Session? = vault.read("session")?.takeIf(String::isNotEmpty)
        ?.let(Session::restore)?.takeIf { it.project == project }

    private fun fresh(session: Session, force: Boolean = false): Session {
        if (!force && session.expires > System.currentTimeMillis() / 1000 + 60) return session
        val next = try { backend.refresh(session) } catch (failure: ApiFailure) {
            if (failure.status in 400..403) throw ApiFailure(401, "expired")
            throw failure
        }
        vault.write("session", next.serialize())
        return next
    }

    private fun workspace(session: Session): Workspace? =
        vault.read("boards")?.takeIf(String::isNotEmpty)?.let(::JSONObject)?.takeIf {
            it.optString("project") == project && it.optString("owner") == session.owner
        }?.let { stored ->
            val list = stored.getJSONArray("boards")
            Workspace(stored.getString("active"), (0 until list.length()).map {
                val board = list.getJSONObject(it)
                Board(board.getString("id"), board.getString("name"))
            })
        }

    private fun queue(): List<Capture> {
        val list = JSONArray(vault.read("outbox") ?: "[]")
        return (0 until list.length()).map { index ->
            val row = list.getJSONObject(index)
            val items = row.getJSONArray("checklist")
            Capture(row.getString("id"), row.getString("project"), row.getString("owner"),
                row.getString("content"), row.optString("board").takeIf(String::isNotEmpty),
                (0 until items.length()).map { items.getString(it) }, row.optString("failure").takeIf(String::isNotEmpty))
        }
    }

    private fun saveQueue(captures: List<Capture>) {
        val rows = captures.map { row ->
            JSONObject().put("id", row.id).put("project", row.project).put("owner", row.owner)
                .put("content", row.content).put("board", row.board).put("checklist", JSONArray(row.checklist))
                .put("failure", row.failure)
        }
        vault.write("outbox", JSONArray(rows).toString())
    }

    private fun clearSession() {
        vault.write("session", "")
        vault.write("boards", "")
        vault.write("oauth", "")
    }

    private fun show(session: Session?, status: WidgetStatus, message: String, reportWidget: Boolean = true) {
        val pending = if (session == null) emptyList() else queue().filter { it.belongsTo(project, session.owner) }
        if (reportWidget) CaptureWidget.publish(this, status)
        view(ScreenState(backend.configured, session?.owner, session?.let(::workspace), pending,
            status == WidgetStatus.SYNCING, message))
    }

    private fun safe(action: () -> Unit) = background.execute {
        try { action() } catch (_: Exception) {
            CaptureWidget.publish(this, WidgetStatus.FAILED)
            handler.post {
                state = state.copy(configured = backend.configured, working = false, message = "WALLFLOW couldn’t complete that action. Try again.")
                listeners.toList().forEach { it(state) }
            }
        }
    }

    internal fun beginSignIn(launch: (Uri) -> Unit) = safe {
        if (!backend.configured || session() != null) return@safe
        val verifier = pkceVerifier()
        vault.write("oauth", JSONObject().put("project", project).put("host", host).put("verifier", verifier)
            .put("created", System.currentTimeMillis()).toString())
        val url = backend.authorization(verifier)
        handler.post { launch(url) }
    }

    internal fun completeSignIn(uri: Uri) = safe {
        if (!backend.configured || session() != null ||
            !acceptsLink(URI(uri.toString()), host, CALLBACK_PATH)) return@safe
        val pending = vault.read("oauth")?.takeIf(String::isNotEmpty)?.let(::JSONObject) ?: return@safe
        val age = System.currentTimeMillis() - pending.getLong("created")
        if (age !in 0..600_000 || pending.optString("project") != project || pending.optString("host") != host) {
            vault.write("oauth", "")
            show(null, WidgetStatus.SIGN_IN, "This sign-in expired. Continue with Google to start again.")
            return@safe
        }
        val codes = uri.getQueryParameters("code")
        if (uri.getQueryParameter("error") != null || uri.getQueryParameter("error_code") != null || codes.size != 1 ||
            !codes[0].matches(Regex("[A-Za-z0-9_-]{1,2048}"))) {
            vault.write("oauth", "")
            show(null, WidgetStatus.SIGN_IN, "Sign-in was cancelled or couldn’t finish. Start again.")
            return@safe
        }
        val signedIn = try {
            backend.exchange(codes.single(), pending.getString("verifier")).also(backend::verify)
        } catch (_: Exception) {
            show(null, WidgetStatus.SIGN_IN, "Sign-in couldn’t finish. Check your connection and start again.")
            return@safe
        } finally { vault.write("oauth", "") }
        vault.write("session", signedIn.serialize())
        syncNow()
    }

    internal fun refresh() = safe { syncNow() }

    internal fun save(expectedOwner: String, body: String, board: String?, checklist: String, saved: () -> Unit) = safe {
        val current = session()?.takeIf { it.owner == expectedOwner } ?: return@safe
        val operation = try { Capture.create(project, current.owner, body, board, checklist) }
        catch (failure: IllegalArgumentException) {
            show(current, WidgetStatus.READY, failure.message.orEmpty(), reportWidget = false)
            return@safe
        }
        saveQueue(queue() + operation)
        handler.post { saved() }
        syncNow()
    }

    internal fun change(expectedOwner: String, id: String, retry: Boolean) = safe {
        val current = session()?.takeIf { it.owner == expectedOwner } ?: return@safe
        val changes = queue().mapNotNull { entry ->
            if (entry.id != id || !entry.belongsTo(project, current.owner) || entry.failure == null) entry
            else if (retry) entry.copy(failure = null) else null
        }
        saveQueue(changes)
        syncNow()
    }

    internal fun signOut() = safe {
        val previous = session()
        clearSession()
        show(null, WidgetStatus.SIGN_IN, "Signed out on this device.")
        if (previous != null && online()) runCatching { backend.logout(previous) }
    }

    private fun syncNow() {
        val storedSession = session()
        if (storedSession == null) {
            show(null, WidgetStatus.SIGN_IN, if (backend.configured) "Sign in with your WALLFLOW Google account."
                else "Configure the WALLFLOW web host and Supabase project to sign in.")
            return
        }
        var session: Session = storedSession
        if (!online()) {
            show(session, WidgetStatus.OFFLINE, "Offline. Captures stay on this device until WALLFLOW can reconnect.")
            return
        }
        var synced = false
        var message = ""
        try {
            val hasPending = queue().any { it.belongsTo(project, session.owner) && it.failure == null }
            show(session, WidgetStatus.SYNCING, "Connecting to your workspace…", reportWidget = hasPending)
            session = fresh(session)
            val boards = try { backend.workspace(session) } catch (error: ApiFailure) {
                if (error.status != 401) throw error
                session = fresh(session, force = true)
                backend.workspace(session)
            }
            vault.write("boards", JSONObject().put("project", project).put("owner", session.owner)
                .put("active", boards.active).put("boards", JSONArray(boards.boards.map {
                    JSONObject().put("id", it.id).put("name", it.name)
                })).toString())
            val entries = queue().toMutableList()
            for (capture in entries.toList()) {
                if (!capture.belongsTo(project, session.owner) || capture.failure != null) continue
                try {
                    session = fresh(session)
                    val remains = backend.capture(session, capture)
                    entries.remove(capture)
                    saveQueue(entries)
                    message = if (remains) "Note synced to your workspace." else "This capture was already saved and later deleted."
                    synced = true
                } catch (error: ApiFailure) {
                    if (error.retryable || error.auth) throw error
                    entries[entries.indexOf(capture)] = capture.copy(failure = error.captureMessage())
                    saveQueue(entries)
                }
            }
            val failed = entries.any { it.belongsTo(project, session.owner) && it.failure != null }
            val status = when {
                failed -> WidgetStatus.FAILED
                synced || CaptureWidget.status(this) == WidgetStatus.SAVED -> WidgetStatus.SAVED
                else -> WidgetStatus.READY
            }
            show(session, status, message.ifEmpty { if (failed) "A capture needs attention." else "Ready to capture." })
        } catch (error: ApiFailure) {
            if (error.auth) {
                clearSession()
                show(null, WidgetStatus.SIGN_IN, "Sign in again to open this workspace. Pending captures are kept for that account.")
            } else {
                show(session, WidgetStatus.OFFLINE, "Couldn’t reach workspace sync. Pending captures are safe to retry.")
            }
        } catch (_: IOException) {
            show(session, WidgetStatus.OFFLINE, "Couldn’t reach workspace sync. Pending captures are safe to retry.")
        }
    }
}
