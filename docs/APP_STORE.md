# CompanySync on the App Store and Google Play

The native apps are a Capacitor shell around the **built** frontend. They are not a website loaded in a frame. API calls go to the production host in `mobile.config.json` (`apiBaseUrl`, default `https://getcompanysync.com`). Change the bundle id in that same file (`appId`, default `com.getcompanysync.app`) or with `CAPACITOR_APP_ID` before `npx cap sync`.

Nothing in this repo is a signing key, a store password, or a live database. Push registration is off unless `VITE_PUSH_ENABLED=true`, and even then the app only stores the device token locally. It does not send notifications.

## What the app is

| Setting | Where to change it | Default |
| --- | --- | --- |
| App name | `mobile.config.json` `appName` or `CAPACITOR_APP_NAME` | CompanySync |
| Bundle id / applicationId | `mobile.config.json` `appId` or `CAPACITOR_APP_ID` | `com.getcompanysync.app` |
| API base | `mobile.config.json` `apiBaseUrl` or `VITE_API_BASE_URL` | `https://getcompanysync.com` |
| Remote page instead of the bundle | `CAPACITOR_SERVER_URL` | empty (bundled assets) |

Leave `CAPACITOR_SERVER_URL` empty for store builds. Apple rejects apps that are only a website in a web view (guideline 4.2). A remote URL is only for a short debug session.

The normal web / Replit build does not set `VITE_CAPACITOR_BUILD`. Relative `/api` URLs stay relative. The native URL rewrite runs only when `window.Capacitor.isNativePlatform()` is true.

## Build the bundle

From the repo root, with Node 22:

```bash
bash scripts/build-mobile.sh
```

That sets `CAPACITOR_BUILD=1` so Vite writes `dist-mobile` and does **not** copy the production server, `db/`, or precompressed `.gz` / `.br` files into the app. Then it runs `npx cap sync`. `dist-mobile/` and the copies under `android/app/src/main/assets/public/` and `ios/App/App/public/` are gitignored so the repo does not store the bundle three times.

Icons and the splash image are generated from `public/icons/icon-512.png`:

```bash
npm run icons:mobile
npx capacitor-assets generate --ios --android --iconBackgroundColor '#1e3a5f' --splashBackgroundColor '#1e3a5f'
npx cap sync
```

Replace `assets/icon-only.png` with a real 1024×1024 master before the final upload. The generated icon is the current logo scaled up.

## iOS (needs a Mac)

Linux cannot compile or sign an iOS app. Use a Mac with Xcode, or a cloud Mac builder (Codemagic is the straightforward one; EAS Build can also run a custom Capacitor iOS workflow).

1. Apple Developer Program membership for the company account.
2. In Xcode, open `ios/App/App.xcworkspace` (`npx cap open ios`).
3. Set the team, bundle id `com.getcompanysync.app`, and a unique version / build number.
4. Enable the Push Notifications capability only after you have an APNs key. Leave `VITE_PUSH_ENABLED` unset until then.
5. Archive (Any iOS Device) and upload with the Xcode Organizer or `xcodebuild`.
6. App Store Connect: create the app, attach the build, fill the listing and privacy answers below.

Codemagic sketch (do not commit signing files):

- Stack: macOS, Xcode current.
- `npm ci`, then `bash scripts/build-mobile.sh`.
- Code signing: App Store distribution certificate and provisioning profile from the Apple account, stored in Codemagic, not in git.
- Artifact: `ios/App/build` archive / IPA.

`ios/App/App/Info.plist` usage strings:

- `NSCameraUsageDescription` — roof, job, and document photos for estimates and PhotoSync.
- `NSPhotoLibraryUsageDescription` — attach existing job and estimate photos.
- `NSPhotoLibraryAddUsageDescription` — save a photo when the user asks.
- `NSMicrophoneUsageDescription` — Lexi and voice notes.
- `NSLocationWhenInUseUsageDescription` — field-rep check-in. Background location is not requested.
- `ITSAppUsesNonExemptEncryption` = false (HTTPS only).

Microphone and camera in the WebView need those strings. Lexi calls `navigator.mediaDevices.getUserMedia({ audio: true })`. iOS shows the system prompt the first time Lexi, a voice note, or the dialer asks. Confirm on a device: tap Lexi, allow the mic, and speak. The socket is rewritten from `ws://localhost/ws/lexi-native` to `wss://<api-base>/ws/lexi-native`.

## Android

On a machine with the Android SDK (API 36, build-tools, JDK 21):

```bash
bash scripts/build-mobile.sh
cd android && ./gradlew assembleDebug
```

The debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`. A store build is `assembleRelease` with an upload keystore that stays **out of git** (`*.jks` and `*.keystore` are ignored). Put the store password in the machine's `keystore.properties` or the CI secret store, not in the repo.

Play Console:

1. Create the app with package name `com.getcompanysync.app`.
2. Upload an AAB (`./gradlew bundleRelease`), not only the debug APK.
3. Complete the data-safety form with the same answers as the Apple privacy labels.
4. **Closed testing:** Google requires a closed test with at least 12 testers opted in for 14 consecutive days before production access for new personal developer accounts. Company accounts have their own review, but a closed track is still the right first upload. Do not use the YICN production tenant as the test company.

`AndroidManifest.xml` permissions match the iOS strings: `INTERNET`, `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`, `READ_MEDIA_IMAGES`, and `READ_EXTERNAL_STORAGE` (max SDK 32). Camera, location, and microphone are `uses-feature` with `required=false`, so a phone without one of them can still install. `RECORD_AUDIO` is what lets Capacitor's WebView (`BridgeWebChromeClient.onPermissionRequest`) grant `getUserMedia` for Lexi. iOS does the same in `WKWebView.requestMediaCapturePermissionFor`, which Capacitor grants, and the system prompt uses `NSMicrophoneUsageDescription`. Confirm on a device: tap Lexi, allow the mic, and speak. If Play asks why the app declares photo access, say the user attaches existing job photos. The image picker itself uses the system photo picker.

Push stays off until `google-services.json` (ignored) is added and `VITE_PUSH_ENABLED=true` is set for that build. The client registers and keeps the token in `sessionStorage`. It does not call a send API.

## Signing

| Store | What Kevin provides | Where it lives |
| --- | --- | --- |
| Apple | Apple Developer account, distribution certificate, provisioning profile, App Store Connect access | Xcode / Codemagic secrets |
| Google | Play Console account, upload keystore, Play App Signing | CI secret or a local file that is not committed |

Do not commit certificates, `.p8` APNs keys, `google-services.json`, or `GoogleService-Info.plist`.

## Store listing checklist

- Name: CompanySync
- Subtitle / short description: roofing CRM, estimates, invoices, and field photos
- Category: Business
- Support URL and privacy policy URL on `https://getcompanysync.com` (the in-app `/privacy` page is the same policy)
- Screenshots: iPhone 6.7", 6.5", iPad 12.9" if you ship iPad; Android phone. Use a demo tenant, not a customer's real jobs.
- Age rating: business app, no restricted content. User-generated photos of job sites are possible.
- Sign-in required: yes. Provide the demo account in the review notes.
- Export compliance: exempt (HTTPS / standard encryption only).
- Content rights: the company owns the software. Job photos belong to the subscriber.

The app does not sell CompanySync subscriptions. Pricing, upgrade, and Stripe Checkout for the SaaS plan are replaced with: "Plan changes are not available in the app. This app does not sell subscriptions or take payment." There is no link to a website checkout. New accounts are created on the web; the app offers sign-in only.

## Privacy labels

Answer from what the product actually stores. The native shell does not add analytics, ad SDKs, or tracking.

| Data | Collected? | Linked to the user? | Purpose |
| --- | --- | --- | --- |
| Name, email, phone | Yes | Yes | Account and CRM records the company enters |
| Precise location | Yes, only when a field rep uses location | Yes | Job check-in (`FieldRepApp`) |
| Photos | Yes | Yes | Estimates and PhotoSync uploads |
| Audio | Yes, while Lexi or a voice note is recording | Yes | Streamed to the assistant; transcripts can be stored on the company |
| User id | Yes | Yes | Session |
| Device push token | Only if `VITE_PUSH_ENABLED=true` | On device only until a future server exists | Not collected in the default build |
| Payment card for a CompanySync subscription | No | — | Subscriptions are not sold in the app |
| Job invoice payments | Only if someone records a customer payment that was already in the web app | Yes, the roofing company | Real-world job payment, not an in-app digital purchase |
| Contacts, browsing history, ads | No | — | — |
| Tracking across other companies' apps | No | — | — |

Health, fitness, and financial-account credentials are not collected. Customer addresses and job notes are user-entered business content and should be declared as contact info / user content.

## Demo reviewer account

Create a **new** tenant only for review. Do not use YICN or any customer company.

1. On the website, sign up a fresh company such as `review@getcompanysync.app` with an obvious sample name ("App Review Roofing").
2. Finish Quick Setup with fake customers, one estimate, and a couple of PhotoSync photos of a house you have rights to.
3. Put the email and password in App Store Connect "Sign-in required" and in the Play review notes. Do not commit them.
4. The account must be able to open the dashboard, take or attach a photo, and open Lexi so the reviewer can allow the microphone.
5. Account deletion is in the profile menu. It deletes that login only. If they are the only person on a company they created, that company is marked closed. It will not delete another tenant, and it will not close `companysync_master_001`.

Tell the reviewer: sign up and plan changes happen on the website; this build is for people who already have an account.

## Native behavior reviewers will touch

- Bundled UI, API on the production host, session cookie via Capacitor HTTP (`SameSite=None` only when the request sends `X-CompanySync-Native: 1`). The website cookie stays `SameSite=Lax`.
- Camera / photo library for image-only uploads (PhotoSync, inspection photos, estimator photo batches). Document uploads that also accept PDF stay on the system file picker.
- Location for field reps, through the existing `navigator.geolocation` calls.
- Status bar, splash, safe area, Android back button.
- Delete account, with the email typed to confirm.

## What a Mac or Kevin still has to do

- Apple Developer and Google Play accounts, and the signing material above.
- A 1024×1024 icon master if the scaled logo is not sharp enough.
- APNs key and `GoogleService-Info.plist` / `google-services.json` before turning push on.
- The review tenant and its password, kept out of git.
- A device pass for Lexi (mic), PhotoSync (camera), and field-rep location. This repo can build the Android debug APK; it cannot install it on a phone or compile iOS.
