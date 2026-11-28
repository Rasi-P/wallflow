package com.wallflow.capture

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Bundle
import android.text.InputFilter
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import java.net.URI

class CaptureActivity : Activity() {
    private val app get() = application as WallflowApplication
    private var stopObserving: (() -> Unit)? = null
    private var screen = ScreenState(false, working = true)
    private lateinit var form: LinearLayout
    private lateinit var status: TextView
    private lateinit var auth: Button
    private lateinit var site: Button
    private lateinit var board: Spinner
    private lateinit var text: EditText
    private lateinit var checklist: EditText
    private lateinit var addChecklist: Button
    private lateinit var send: Button
    private lateinit var outbox: LinearLayout
    private var targetIds = emptyList<String?>()
    private var focusComposer = false
    private var submitting = false
    private var fileOwner: String? = null
    private val connectivity by lazy { getSystemService(ConnectivityManager::class.java) }
    private val network = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { app.refresh() }
        override fun onLost(network: Network) { app.refresh() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildScreen()
        route(intent)
    }

    override fun onStart() {
        super.onStart()
        stopObserving = app.observe(::render)
        runCatching { connectivity.registerDefaultNetworkCallback(network) }
        app.refresh()
    }

    override fun onStop() {
        stopObserving?.invoke()
        runCatching { connectivity.unregisterNetworkCallback(network) }
        super.onStop()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        route(intent)
    }

    private fun route(intent: Intent) {
        if (intent.action == CaptureWidget.OPEN_CAPTURE) {
            focusComposer = true
            maybeFocus()
        } else if (intent.action == Intent.ACTION_VIEW) {
            val uri = intent.data ?: return
            val parsed = runCatching { URI(uri.toString()) }.getOrNull() ?: return
            if (acceptsLink(parsed, app.host, CALLBACK_PATH)) {
                setIntent(Intent(this, CaptureActivity::class.java))
                focusComposer = true
                app.completeSignIn(uri)
            } else if (acceptsLink(parsed, app.host, CAPTURE_PATH) && parsed.rawQuery == null) {
                focusComposer = true
                maybeFocus()
            }
        }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

    private fun addButton(parent: LinearLayout, label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        minHeight = dp(48)
        setOnClickListener { action() }
        parent.addView(this)
    }

    private fun buildScreen() {
        val root = column()
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root)
            setOnApplyWindowInsetsListener { _, insets ->
                if (android.os.Build.VERSION.SDK_INT >= 30) {
                    val padding = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                    root.setPadding(dp(22) + padding.left, dp(16) + padding.top, dp(22) + padding.right, dp(22) + padding.bottom)
                } else {
                    root.setPadding(dp(22), dp(16), dp(22), dp(22))
                }
                insets
            }
        }
        setContentView(scroll)
        val brand = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        brand.addView(ImageView(this).apply { setImageResource(R.drawable.wallflow_icon) }, dp(36), dp(36))
        brand.addView(TextView(this).apply {
            text = "WALLFLOW"; textSize = 15f; setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(dp(10), 0, 0, 0)
        })
        root.addView(brand)
        root.addView(TextView(this).apply {
            text = "Quick Capture"; textSize = 32f; setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, dp(16), 0, dp(4))
        })
        status = TextView(this).apply {
            textSize = 15f
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
            setPadding(0, 0, 0, dp(14))
        }
        root.addView(status)
        form = column()
        root.addView(form)
        form.addView(TextView(this).apply { text = "Board"; textSize = 13f })
        board = Spinner(this).apply { minimumHeight = dp(48); contentDescription = "Target board" }
        form.addView(board, LinearLayout.LayoutParams(-1, dp(48)))
        text = EditText(this).apply {
            hint = "What’s on your mind?"
            contentDescription = "Note"
            minLines = 3
            maxLines = 6
            gravity = Gravity.TOP
            filters = arrayOf(InputFilter.LengthFilter(240))
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            isSaveEnabled = false
        }
        form.addView(text)
        addChecklist = addButton(form, "Add checklist") {
            checklist.visibility = if (checklist.visibility == View.GONE) View.VISIBLE else View.GONE
            addChecklist.text = if (checklist.visibility == View.GONE) "Add checklist" else "Hide checklist"
        }
        checklist = EditText(this).apply {
            hint = "One checklist item per line"
            contentDescription = "Checklist"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE
            filters = arrayOf(InputFilter.LengthFilter(3000))
            minLines = 2
            maxLines = 5
            visibility = View.GONE
            isSaveEnabled = false
        }
        form.addView(checklist)
        send = addButton(form, "Capture note") {
            val owner = screen.account ?: return@addButton
            if (submitting || screen.working) return@addButton
            submitting = true
            send.isEnabled = false
            app.save(owner, text.text.toString(), targetIds.getOrNull(board.selectedItemPosition) ?: screen.workspace?.active,
                if (checklist.visibility == View.VISIBLE) checklist.text.toString() else "") {
                text.text.clear()
                checklist.text.clear()
                getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(text.windowToken, 0)
            }
        }
        outbox = column()
        root.addView(outbox)
        auth = addButton(root, "Continue with Google") {
            if (screen.account == null) app.beginSignIn { url ->
                if (!isFinishing) runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    .onFailure { status.text = "A browser is required for Google sign-in." }
            } else AlertDialog.Builder(this).setMessage("Sign out of WALLFLOW on this device?")
                .setNegativeButton("Cancel", null).setPositiveButton("Sign out") { _, _ ->
                    auth.isEnabled = false
                    form.visibility = View.GONE
                    outbox.removeAllViews()
                    text.text.clear()
                    checklist.text.clear()
                    app.signOut()
                }.show()
        }
        site = addButton(root, "Open WALLFLOW workspace") {
            if (app.host.isNotEmpty()) runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://${app.host}/app/"))) }
        }
    }

    private fun render(next: ScreenState) {
        screen = next
        if (fileOwner != next.account) {
            fileOwner = next.account
            text.text.clear()
            checklist.text.clear()
            checklist.visibility = View.GONE
            addChecklist.text = "Add checklist"
        }
        submitting = false
        form.visibility = if (next.account != null) View.VISIBLE else View.GONE
        auth.visibility = if (next.configured) View.VISIBLE else View.GONE
        site.visibility = if (next.configured) View.VISIBLE else View.GONE
        auth.text = if (next.account == null) "Continue with Google" else "Sign out"
        auth.isEnabled = !next.working
        send.isEnabled = !next.working
        status.text = next.message

        val choices = next.workspace?.boards.orEmpty()
        val previous = targetIds.getOrNull(board.selectedItemPosition)
        targetIds = listOf(null) + choices.map { it.id }
        val activeName = choices.find { it.id == next.workspace?.active }?.name
        val labels = listOf(activeName?.let { "Current board · $it" } ?: "Active board at sync") + choices.map { it.name }
        board.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
        board.setSelection(targetIds.indexOf(previous).coerceAtLeast(0))
        outbox.removeAllViews()
        if (next.pending.isNotEmpty()) {
            outbox.addView(TextView(this).apply { text = "Capture outbox"; textSize = 17f })
            for (entry in next.pending) {
                outbox.addView(TextView(this).apply {
                    text = listOf(entry.content.ifEmpty { entry.checklist.firstOrNull().orEmpty() },
                        entry.failure ?: "Pending sync").joinToString("\n")
                    maxLines = 4
                    setPadding(0, dp(7), 0, dp(4))
                })
                if (entry.failure != null) {
                    val buttons = LinearLayout(this)
                    outbox.addView(buttons)
                    addButton(buttons, "Retry") { next.account?.let { app.change(it, entry.id, true) } }.isEnabled = !next.working
                    addButton(buttons, "Discard") {
                        AlertDialog.Builder(this).setMessage("Discard this failed capture?")
                            .setNegativeButton("Cancel", null).setPositiveButton("Discard") { _, _ ->
                                next.account?.let { app.change(it, entry.id, false) }
                            }.show()
                    }.isEnabled = !next.working
                }
            }
            addButton(outbox, "Sync now", app::refresh).isEnabled = !next.working
        }
        maybeFocus()
    }

    private fun maybeFocus() {
        if (!focusComposer || !::text.isInitialized || screen.account == null) return
        focusComposer = false
        text.requestFocus()
        text.postDelayed({ getSystemService(InputMethodManager::class.java).showSoftInput(text, InputMethodManager.SHOW_IMPLICIT) }, 120)
    }
}
