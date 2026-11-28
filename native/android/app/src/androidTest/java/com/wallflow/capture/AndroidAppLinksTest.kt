package com.wallflow.capture

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidAppLinksTest {
    @Test fun googleAuthorizationUsesTheExactWallflowCallback() {
        val client = Supabase("https://project.example", "sb_publishable_fixture", "wallflow-chi.vercel.app")
        val authorization = client.authorization(pkceVerifier())

        assertEquals("https://wallflow-chi.vercel.app/auth/native/android/callback", authorization.getQueryParameter("redirect_to"))
        assertEquals("google", authorization.getQueryParameter("provider"))
        assertEquals("s256", authorization.getQueryParameter("code_challenge_method"))
    }
}
