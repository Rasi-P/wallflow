package com.wallflow.capture

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

class CaptureWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) manager.updateAppWidget(id, views(context, id))
    }

    companion object {
        internal const val OPEN_CAPTURE = "com.wallflow.capture.OPEN_CAPTURE"
        private const val PREFERENCES = "wallflow-widget-status"

        internal fun captureIntent(context: Context) = Intent(context, CaptureActivity::class.java).setAction(OPEN_CAPTURE)

        internal fun status(context: Context): WidgetStatus {
            val label = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString("status", null)
            return WidgetStatus.entries.find { it.name == label } ?: WidgetStatus.SIGN_IN
        }

        internal fun views(context: Context, id: Int): RemoteViews {
            val open = PendingIntent.getActivity(context, id, captureIntent(context), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            return RemoteViews(context.packageName, R.layout.capture_widget).apply {
                setTextViewText(R.id.widget_status, status(context).label)
                setOnClickPendingIntent(R.id.widget_capture, open)
                setOnClickPendingIntent(R.id.widget_root, open)
            }
        }

        internal fun publish(context: Context, status: WidgetStatus) {
            val prefs = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            if (prefs.getString("status", null) == status.name) return
            prefs.edit().putString("status", status.name).apply()
            val manager = AppWidgetManager.getInstance(context)
            val provider = ComponentName(context, CaptureWidget::class.java)
            for (id in manager.getAppWidgetIds(provider)) manager.updateAppWidget(id, views(context, id))
        }
    }
}
