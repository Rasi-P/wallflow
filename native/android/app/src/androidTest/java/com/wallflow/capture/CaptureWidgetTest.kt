package com.wallflow.capture

import android.content.Context
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CaptureWidgetTest {
    @Test fun remoteViewOpensNativeComposerAndShowsOnlyGenericStatus() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        instrumentation.runOnMainSync {
            CaptureWidget.publish(context, WidgetStatus.OFFLINE)
            try {
                val view = CaptureWidget.views(context, 7).apply(context, FrameLayout(context))
                assertEquals(WidgetStatus.OFFLINE.label, view.findViewById<TextView>(R.id.widget_status).text.toString())
                assertTrue(view.findViewById<View>(R.id.widget_capture).hasOnClickListeners())
                val intent = CaptureWidget.captureIntent(context)
                assertEquals(CaptureActivity::class.java.name, intent.component?.className)
                assertNull(intent.data)
            } finally {
                context.getSharedPreferences("wallflow-widget-status", Context.MODE_PRIVATE).edit().clear().commit()
            }
        }
    }
}
