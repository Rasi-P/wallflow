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
        assertTrue(acceptsLink(URI("https://wall.example$CALLBACK_PATH?code=abc"), "wall.example", CALLBACK_PATH))
        for (url in listOf("http://wall.example$CALLBACK_PATH", "https://wall.example.evil$CALLBACK_PATH",
            "https://alice@wall.example$CALLBACK_PATH", "https://wall.example:444$CALLBACK_PATH",
            "https://wall.example$CALLBACK_PATH#token", "https://wall.example$CALLBACK_PATH/")) {
            assertFalse(acceptsLink(URI(url), "wall.example", CALLBACK_PATH))
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
