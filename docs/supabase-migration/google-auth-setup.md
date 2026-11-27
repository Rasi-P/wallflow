# Google Auth setup and account mapping

WALLFLOW uses Supabase Auth with Google PKCE and explicit callback handling. Use a separate Supabase development project and Google OAuth client for live staging tests.

## Provider and callbacks

Create a Google OAuth web client for the separate development project and configure its consent screen and test users. In that project's Supabase Auth settings, enable Google and enter the client ID and secret. Register the exact Supabase provider callback shown by the dashboard in Google Cloud. The adapter uses Supabase's standard Google identity scopes.

| Environment | Google’s authorized redirect URI | WALLFLOW callback allowed by Supabase |
| --- | --- | --- |
| Local Supabase stack | `http://127.0.0.1:55321/auth/v1/callback` using the checked-in API port. Confirm the exact URL configured for the local provider. | `http://localhost:5173/auth/callback` |
| Hosted development | `https://<development-project-ref>.supabase.co/auth/v1/callback` | `http://localhost:5173/auth/callback` or the exact development app origin with `/auth/callback` |
| Future production | `https://<production-project-ref>.supabase.co/auth/v1/callback` | `https://<production-wallflow-domain>/auth/callback` |

Set the Auth Site URL to the app origin for each project. Use exact callback allowlists and separate production and development credentials. If serving local Vite on another port, add the exact callback for that origin. Keep unused providers and manual linking disabled. Run provider secrets through the local environment or Supabase provider settings and use the publishable key in Vite.

For an approved local Google OAuth rehearsal, configure the local provider with environment references. This example is for local use with the checked-in API port.

```toml
[auth.external.google]
enabled = true
client_id = "env(WALLFLOW_LOCAL_GOOGLE_CLIENT_ID)"
secret = "env(WALLFLOW_LOCAL_GOOGLE_CLIENT_SECRET)"
redirect_uri = "http://127.0.0.1:55321/auth/v1/callback"
```

## Browser flow

1. Start `signInWithOAuth` with the Google provider and the configured app callback as `redirectTo`. Request Google’s account chooser so the user can switch accounts after signing out.
2. After the return to WALLFLOW, pass the authorization code to `exchangeCodeForSession` exactly once in the browser that started the PKCE flow. Clean the callback URL and navigate to a fixed app destination. Keep callback failures and cancel/retry visible to the user.
3. Verify the signed-in identity and workspace eligibility before showing account data. Use SDK session persistence and token refresh with account-scoped auth events. Expired sessions require reauthentication. Support simultaneous sessions on phone and laptop.
4. Resolve pending edits before explicit sign-out when possible. On sign-out, session expiry, or an account-change signal, stop writes, reminders, and subscriptions, conceal the previous workspace, and scope any saved recovery payload to the verified previous owner.

The SQL read gate checks the session row and a 14-day maximum age. Supabase’s configurable time-box applies at refresh and requires an eligible plan. The app uses SDK-managed browser credentials. Decide whether to retain that credential model or add an HttpOnly session layer before production rollout.

## Approve a development test account

1. Use the development project from [local development](local-development.md), sign in once with your development test Google account, and record its Auth user UUID from the development dashboard.
2. In that same development project's SQL editor, inspect the managed identity's provider and subject. Confirm that the candidate has exactly one identity and that its Google `provider_id` and identity `sub` agree. Approve a new synthetic test account with the operator function.

```sql
select provider, provider_id, identity_data ->> 'sub' as subject
from auth.identities
where user_id = '<development-auth-user-uuid>'::uuid;

select wallflow_private.reconcile_google_account(
  '<development-auth-user-uuid>'::uuid,
  '<verified-development-google-subject>'
);
```

3. A null reconciliation result means the new test profile was approved. A legacy UUID means the mapping is held for a future migration. For an approved account, choose **Retry session check**. Confirm the first board appears, cancel a separate sign-in, reload the page, sign out, and switch to a second approved account. Check both accounts on the approved development origin.

## Existing users

The private reconciliation function compares Django’s recorded Google `sub` with the single trusted Google identity in `auth.identities`. It records the original Django user UUID and the verified Supabase owner UUID. Duplicate mappings, other providers, misleading user metadata, mismatched subjects, and disabled legacy accounts cannot claim a workspace. Any already recorded match stays ineligible for cloud workspace access until a separately approved migration imports and reconciles its data. Use synthetic legacy mappings for development tests.

- [Supabase Google provider](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
- [Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Google OpenID Connect claims](https://developers.google.com/identity/openid-connect/openid-connect#an-id-tokens-payload)
