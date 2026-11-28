# WALLFLOW on phones and tablets

WALLFLOW uses one Supabase account workspace across the desktop 3D wall, the mobile web workspace and the native capture companions. The companions open a small native composer from the Home Screen. Their widget surfaces display generic capture status.

## Web app and Vercel

Use Node 24. Set the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` variables to the intended Supabase project.

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run verify:build
npm run preview -- --host 127.0.0.1 --port 4173
```

Use Vite development for UI iteration. Use the production build on localhost or 127.0.0.1 to test installation, Cache Storage and service-worker updates. Allowlist the exact local web callback if testing Google sign-in there. On physical devices use an HTTPS preview origin with its own allowed callbacks.

- Open the mobile **Settings** screen for the theme and **Install WALLFLOW**. Use the board picker and **Manage boards** for switching, imports, backup and conflict recovery. The calendar opens Today, deadlines, reminders and archive. Tap the lightning icon for **Quick Capture** and the outbox. Drag notes with one finger and pinch or move two fingers to navigate the same 3D wall. **Fit whole board** shows every note, and **More wall tools** contains Reset, Redo and the one-finger pan mode.
- Chromium can show an install prompt. On iPhone or iPad, open Safari and use **Share → Add to Home Screen**. Open the installed app once online to prime its shell and account workspace. With a new release waiting, select **Refresh** to persist account drafts and activate the update.
- The worker precaches a release-specific public shell and lazily caches only the repository’s public environment images. Allowed navigation paths use the cached shell. It omits cookies on cache fills and excludes OAuth callbacks, query-bearing requests, authorization headers, API traffic, private responses and all cross-origin traffic.
- A cold offline launch opens a downloaded account workspace only when the browser still has the exact, unexpired Supabase session previously verified with that workspace. An expired or missing session requires reconnecting before accessing account data. Device-only boards remain available from sign-in.
- Web reminders use the existing in-app scheduler and available browser notification permission.

Set the following additional values on a dedicated HTTPS Vercel preview when device-testing links. Omit both values for an unconfigured platform. The build emits empty association files for unconfigured platforms.

| Build variable | Value |
| --- | --- |
| `WALLFLOW_ANDROID_APPLICATION_ID` | The installed APK’s application ID |
| `WALLFLOW_ANDROID_SHA256_FINGERPRINTS` | Comma-separated signing certificate fingerprints in SHA-256 colon-delimited hex |
| `WALLFLOW_IOS_TEAM_ID` | Your 10-character Apple Developer team ID |
| `WALLFLOW_IOS_BUNDLE_ID` | The iOS app bundle ID used for signing |

For device testing, use a preview whose public shell and association files can be fetched without Vercel Deployment Protection. Vercel serves the generated files at `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`. Serve them on the exact host used in the native app, with HTTPS, HTTP 200, JSON content type and no redirects. The regular web capture URL is `/capture`. Native Universal Links and App Links use `/capture/native/ios` and `/capture/native/android` respectively. Those routes can also open the web composer in a browser. [Android website associations](https://developer.android.com/training/app-links/configure-assetlinks), [Apple associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains)

## Shared integration contract

### Authentication and identity

- The web app and companions use Google through the same Supabase Auth project. Each application owns its own Supabase session. The native apps open an external or system browser and use S256 PKCE. The same Google identity resolves to the same Supabase user UUID.
- In the authorized development Supabase project, enable Google as documented for the web app. Keep Google's redirect URL pointed at the Supabase project’s Google callback. In Supabase Auth **Redirect URLs**, add the exact HTTPS URLs `https://<web-host>/auth/callback`, `https://<web-host>/auth/native/android/callback` and `https://<web-host>/auth/native/ios/callback`. The native callbacks use verified links. Their browser fallback uses `no-store` and `no-referrer` headers. [Google setup](supabase-migration/google-auth-setup.md), [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- The app generates a random verifier, sends its SHA-256 challenge to `/auth/v1/authorize`, then exchanges the short-lived Supabase authorization code through `/auth/v1/token?grant_type=pkce`. Android retains the in-flight verifier in its encrypted app vault for up to 10 minutes. iOS keeps it in memory for the active system authentication session. The user session is verified with Supabase before the app saves it.
- The companions use only a publishable key and a signed-in user's access token. Android protects sessions and pending captures with an Android Keystore AES-GCM key. iOS keeps sessions in device-only Keychain entries and queues in app-private, file-protected storage excluded from device backups. Android's widget preferences and the iOS App Group hold only a generic status, with a freshness timestamp on iOS. [Supabase Auth API](https://github.com/supabase/auth/blob/master/openapi.yaml)
- Each app refreshes expired access tokens using its own securely stored refresh token. On sign-out, the app clears its session and transient account view. When online the companions also request local-scope revocation. The web app retains scoped recovery drafts. Companions retain only their scoped unsent operations. Signing in as a different user or changing project never replays them.

### Capture and sync

1. Before issuing a command, initialize with `initialize_wallflow_workspace(expected_owner_id)`. Read eligible boards and the current board through the existing workspace read or preview RPC.
2. Persist a random operation UUID, project origin, signed-in owner UUID, note content, chosen board UUID if available and optional checklist. A current board selected in the UI is pinned by ID if known. With no available board snapshot, send a null board ID so the server resolves the active board at commit time.
3. Call `quick_capture_wallflow_note` with `expected_owner_id`, `operation_id`, `content`, and `board_id`. Include `checklist` as an array of strings only when supplied. Supply up to 240 UTF-16 units of body text and up to 24 checklist items of 120 UTF-16 units each. A checklist-only note is valid. The server trims text and checks the 60 active-note limit.
4. A successful result has `note`, `noteId` and a string `revision`. Keep the payload and UUID through transport retries. Replays return the original note identity and current revision. They may return `note: null` if the note or board was deleted. In that case treat the capture as acknowledged. The database retains receipts.
5. The worker and widget extension stay out of account storage and networking. The foreground web app retries when online, visible or reopened. Native apps retry when opened or when the foreground app sees connectivity return. The Supabase transaction advances the workspace revision and broadcasts to existing private Realtime subscribers. Native companions fetch the current board list on foreground sync. iOS asks WidgetKit to reload its timeline after user-visible status changes. Android updates installed RemoteViews directly.

| Result | What the user sees |
| --- | --- |
| Offline, HTTP 429, timeout or 5xx | Pending on this device. Replay keeps the same UUID. |
| Expired, revoked or ineligible session | Reauthenticate with the same account. Pending entries remain scoped. |
| `board_full` or `board_unavailable` | Failed with a reason. Archive a note or confirm the board, then retry or discard. |
| `capture_conflict` | Failed because the UUID was previously used for different content. |
| Success or deleted-note replay | Synced or already recorded, with the pending entry removed. |

### Database and rollout

`20261128000300_wallflow_capture_checklist.sql` adds a checklist overload to the existing authenticated RPC. It retains the four-argument endpoint and body-only digest used by older clients and migrated receipts. The existing owner verification, lock, snapshot writer, normalized projection, receipt, capacity rules and private Realtime notification apply to the new overload. The migration adds no tables or policies. The local SQL suite covers each RPC’s grants and the body-only capture path, including old receipts, deleted-note replay and checklist validation. [Original Quick Capture contract](supabase-migration/quick-capture.md)

Apply the migration to a hosted environment only after authorization and before enabling checklist captures there. Text capture still uses the existing four-argument RPC. The native and web build configuration requires no credential beyond the publishable key.

## Android build and device test

Install a JDK 17 and Android SDK Platform 36 with Build Tools 35.0.0. The included wrapper pins Gradle 8.11.1. Open the project in Android Studio if you prefer its SDK manager, emulator or signing interface. The app runs on Android 8.0 or later. Use Android 12 or later to exercise the modern verified links diagnostics. Choose a unique application ID and a signing key appropriate for your testing environment.

```sh
cd native/android
export WALLFLOW_WEB_HOST=wallflow.example.com
export WALLFLOW_SUPABASE_URL=https://example-ref.supabase.co
export WALLFLOW_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
export WALLFLOW_ANDROID_APPLICATION_ID=com.yourorganization.wallflow
./gradlew :app:signingReport
./gradlew :app:testDebugUnitTest :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:connectedDebugAndroidTest
```

Use the signing report’s matching SHA-256 fingerprint in the preview build. If distributing with Play App Signing later, use the certificate that signs the APK installed on the device. [Android App Links troubleshooting](https://developer.android.com/training/app-links/troubleshoot), [Android Gradle Plugin requirements](https://developer.android.com/build/releases/agp-8-10-0-release-notes)

1. Install the debug APK, then add **WALLFLOW** from the launcher’s widget picker. Start the first Google sign-in by tapping **Quick Capture** on the widget. Confirm the callback returns to the native composer.
2. Verify Android’s link registration. Replace the example application ID and host below with the values used in the installed build and its association file.

   ```sh
   adb shell pm verify-app-links --re-verify com.yourorganization.wallflow
   adb shell pm get-app-links com.yourorganization.wallflow
   adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d https://wallflow.example.com/capture/native/android
   ```

3. Select a board, enter a note and checklist, and submit. See the note in a signed-in browser and the status update on the widget.
4. Turn on airplane mode, open the composer from the widget, submit and close the app. Reopen, confirm the pending entry, restore network connectivity while the composer is visible and verify that it syncs once. Use **Sync now** to retry a transient API outage.
5. With a pending capture, sign out and sign in as a second authorized Google user. Confirm the old capture is hidden. Sign back into the original account to finish syncing it.

## iOS build and device test

Install full Xcode 16 or later and select it as the active developer directory. The app requires iOS or iPadOS 17.4 or later. Use an Apple Developer team with Associated Domains and App Groups configured for the chosen identifiers.

```sh
cd native/ios
cp Local.xcconfig.example Local.xcconfig
swift test
xcodebuild -project Wallflow.xcodeproj -scheme Wallflow -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

1. Edit `Local.xcconfig` with your team, app bundle ID, registered App Group, HTTPS preview host, project URL and publishable key. Keep the xcconfig URL syntax shown in the example. Under **Signing & Capabilities**, select your team for **Wallflow** and **CaptureWidget**. Attach the same App Group to both targets and enable Associated Domains on the app. Install the signed build on a device.
2. Add the small or medium **WALLFLOW Quick Capture** widget from the Home Screen’s widget gallery. Tap it to open the composer. Complete Google sign-in through the system authentication prompt and confirm the account appears in the native app.
3. From Notes or Messages tap `https://<web-host>/capture/native/ios` and confirm the Universal Link opens the composer. For a fresh association file, allow for Apple’s CDN propagation. [Debugging Universal Links](https://developer.apple.com/documentation/Technotes/tn3155-debugging-universal-links)
4. Capture text and a checklist into a chosen board. Check that the web workspace updates and WidgetKit reflects the generic result when it reloads. On small widgets the entire widget opens Quick Capture. On medium widgets the labeled link also opens it. Text entry runs in the foreground SwiftUI composer. A Shortcuts action can open the same composer. [WidgetKit interactions](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities)
5. Repeat the offline and account-switching tests from Android. Use the app’s **Sync now** action after an API outage. Verify a signed-out widget opens the sign-in screen without displaying text from the previous account.

## Repeat the mobile wall browser review

Build WALLFLOW and run the optional Chrome test with Playwright installed. Pass a directory for screenshots and, optionally, a separate pre-change build directory to compare the desktop screenshots.

```sh
node --experimental-strip-types tests/mobileWall.browser.ts /tmp/wallflow-screenshots /path/to/baseline-dist
```

Use `WALLFLOW_PLAYWRIGHT_MODULE` for Playwright installed outside the project and `WALLFLOW_CHROMIUM_BINARY` for a local Chrome binary. The test uses an isolated browser profile, synthetic notes, and emulated touch input. On physical phones, repeat the drag, corner resize, pinch, two-finger pan, rotation and keyboard tests with the installed PWA.

## Release checklist

- [ ] Run web typecheck, unit tests, the production build and the build scanner.
- [ ] Run SQL and Data API tests against a disposable local stack. Run the browser integration with the production preview.
- [ ] Verify the targeted development Supabase project has the existing Quick Capture migrations and the checklist migration. Confirm private Realtime updates on a second browser.
- [ ] Test the APK and signed iOS build on devices. Check Google account selection, verified links, widget refresh, back-to-back captures and session expiry. On a test board at capacity, verify that a failed capture succeeds once after archiving a note and tapping Retry.
- [ ] Exercise PWA installation, offline relaunch, account switching and the update prompt under a new release. Check the public cache contains only static files.
- [ ] Confirm the deployed association files match each signed test build and the exact preview domain. Validate the native callbacks’ response headers.
- [ ] Before releasing to production, obtain approval for the hosted Supabase migration and OAuth redirect changes. Review the Vercel release and signed binaries with their owners.
