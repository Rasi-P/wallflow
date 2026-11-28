package com.wallflow.capture

import org.junit.Assert.*
import org.junit.Test
import java.net.URI

class CaptureContractTest {
    @Test fun pkceUsesS256() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
        assertNotEquals(pkceVerifier(), pkceVerifier())
    }

    @Test fun verifiedLinkUsesExactHostAndPath() {
        val host = "wallflow-chi.vercel.app"
        val callback = "https://wallflow-chi.vercel.app/auth/native/android/callback"
        val capture = "https://wallflow-chi.vercel.app/capture/native/android"
        assertTrue(acceptsLink(URI("$callback?code=abc"), host, CALLBACK_PATH))
        assertTrue(acceptsLink(URI(capture), host, CAPTURE_PATH))
        for (url in listOf("http://$host$CALLBACK_PATH", "https://$host.evil$CALLBACK_PATH",
            "https://alice@$host$CALLBACK_PATH", "https://$host:444$CALLBACK_PATH",
            "$callback#token", "$callback/", capture)) {
            assertFalse(acceptsLink(URI(url), host, CALLBACK_PATH))
        }
    }

    @Test fun queueScopesAndPreservesOperation() {
        val operation = Capture.create("https://project.example", "a", "", "board", " First\nSecond ")
        assertEquals(listOf("First", "Second"), operation.checklist)
        assertEquals(operation.id, operation.copy(failure = "full").copy(failure = null).id)
        assertFalse(operation.belongsTo("https://project.example", "b"))
        assertFalse(operation.belongsTo("https://other.example", "a"))
        assertThrows(IllegalArgumentException::class.java) {
            Capture.create("p", "a", "🔬".repeat(121), null, "")
        }
    }
}
