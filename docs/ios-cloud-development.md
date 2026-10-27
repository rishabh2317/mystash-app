# Mystash iOS cloud development

Setup checked on 2026-10-26. The approved cloud project was created and this
checkout linked. Owner-approved iOS Simulator cloud builds are recorded below.
Appetize hosted testing was subsequently completed on its free plan. No paid
service, local Simulator runtime, CocoaPods installation, or local native project
was started or created.

## Dedicated build profile

`eas.json` contains `ios-simulator` with `ios.simulator: true`,
`ios.buildConfiguration: Release`, `distribution: internal`, and
`environment: preview`. It does not inherit from or change existing profiles.
The app's existing iOS and Android identifiers remain unchanged.

This profile embeds JavaScript in the app. It does not require a running Metro
server or `expo-dev-client`, making it suitable for browser-hosted testing.
JavaScript changes require another build for this profile. A live-reload dev
client can be considered separately if needed.

## Account and project prerequisites

- Signed-in personal Expo account: `rishabh17`.
- The account had no existing projects. With owner approval,
  [@rishabh17/Mystash](https://expo.dev/accounts/rishabh17/projects/Mystash)
  was created and this checkout linked.
- `app.json` now records owner `rishabh17` and the real EAS project ID
  `2a341a10-5b80-419d-889b-44ab2f39a066`. `eas project:info` verified the linkage.
- Preserve `com.anonymous.Mystash` for both existing application identifiers.
  Store-distribution identity decisions are outside this Simulator setup.
- Simulator builds do not require Apple Developer Program membership or device
  signing credentials. Physical iPhone distribution is a separate workflow.

## Environment variables

Only these public client variables were copied from the existing main Mystash
checkout into this worktree's Git-ignored `.env.local`, with permissions `0600`:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_MYSTASH_INGEST_URL`

Values were not printed or committed. The Supabase key was checked to be a
public client key, not a service-role credential. Both URLs use HTTPS and public
hostnames; endpoint availability and credential validity have not been tested.
These are the existing app endpoints; no separate staging backend was created.

All three variables are now configured at project scope in the EAS `preview`
environment with `sensitive` visibility. A fresh read-only API session verified
each remote value matches `.env.local`, without printing any value.
Local ignored environment files alone are not sufficient for remote builds.
Sensitive visibility avoids casually exposing values in tooling, but remember that
`EXPO_PUBLIC_*` values are embedded in the client bundle and are not secrets.
Never use a Supabase service-role key or backend provider keys here.

The newly created project had no conflicting project variables. Only these
three project-scoped `preview` variables were created; no account-wide,
development, or production variables were changed. The existing Android preview
profile may also consume this shared `preview` environment; the values match
the existing Mystash checkout. Review remote variables before future overwrites.

## Hosted testing

### Expo Simulators

The personal account's `device-run-sessions` feature gate returned `false` via
Expo's read-only account API. After linkage, the official CLI also confirmed
`available: false` for `rishabh17`. Recheck later with:

```sh
npx eas-cli simulator:availability --json
```

Do not start a session without approval. The service is a limited-access preview;
paying for an EAS plan does not itself grant access.

### Appetize fallback

1. Obtain approval before creating the EAS build or starting paid services.
2. Account linkage and cloud environment variables are configured. Once
   validation issues are resolved/reviewed, the intended cloud build command is:
   `npx eas-cli build --platform ios --profile ios-simulator`.
   This command was run only after owner approval, with `--non-interactive`
   and `--no-wait`. Do not add `--local`.
3. Keep the artifact in EAS when possible. Appetize needs a `.zip` or `.tar.gz`
   containing an iOS Simulator `.app`; an App Store/device `.ipa` is unsuitable.
   Upload the EAS artifact through Appetize's supported import/upload workflow.
   If a local download is required, allow space for the archive and avoid
   extracting a second copy unless necessary.
4. Select a supported iOS version/device and launch the browser session. An
   Appetize account and sufficient session entitlement are required; check its
   current pricing before starting paid usage.
5. Test layout, navigation, authentication, deep links, photo-library flows,
   and ingestion against the configured backend. These actions can affect the
   existing backend; use an appropriate test account and test data.
6. Verify hardware-dependent behavior and final performance on a physical
   iPhone separately. A hosted Simulator is not complete device QA.

## Validation and storage

- `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline` restored root
  JavaScript dependencies from the existing lockfile. Backend dependencies were
  not installed. Install scripts were skipped; no native artifacts were built.
- Expo public configuration resolves successfully with SDK 54 and New
  Architecture enabled.
- Expo Doctor: **18/18 checks pass** after the approved compatibility fixes.
  Expo is locked to `54.0.38`, expo-constants to `18.0.14`, expo-font to
  `14.0.12`, and expo-router to `6.0.24`. React Native remains `0.81.5`.
- The unsupported `android.usesCleartextTraffic` field was moved to the
  supported `expo-build-properties` plugin (`1.0.10`) with the same `true`
  setting. In-memory native configuration introspection verified cleartext HTTP
  is enabled and the existing Android share target is retained; it did not
  generate native folders or run a build.
- `expo install --check` passes: dependencies are up to date. Only four existing
  direct dependency ranges were updated, plus the build-properties config
  plugin. npm updated the lockfile and the associated transitive dependencies;
  install scripts remained disabled.
- `node_modules` uses approximately 555 MiB. On-demand EAS/Doctor tooling added
  npm cache data. Available disk space fluctuated from 12 GiB before setup to
  14 GiB at the later check; this is not evidence of space reclaimed by setup.
- Existing EAS profiles remain unchanged. Changes also include the standalone
  profile in `eas.json`, owner/project linkage in `app.json`, and the dependency
  fixes above. EAS initialization normalized Android permissions as a side
  effect; those changes were restored before verification. The complete `ios`
  object and all Android settings other than relocating the cleartext flag match
  the original commit. Both identifiers remain `com.anonymous.Mystash`.
  No `ios/` or `android/` directory was generated.

Project creation, linkage, and required cloud environment configuration are
complete, and the Doctor findings are resolved. Compatibility checks and
in-memory native configuration checks do not replace runtime testing on Android
and iOS.

## Approved cloud build attempts

Before submission, the Expo account API reported the Free plan, 0/30 included
builds used, no overage metrics, and zero build cost. Builds were submitted
non-interactively; no paid upgrade or service was accepted.

- [First attempt](https://expo.dev/accounts/rishabh17/projects/Mystash/builds/adbb7f6c-1ded-46b9-8be8-15fb48d1bc90)
  failed during JavaScript bundling because the existing Babel config could not
  resolve `babel-preset-expo` at project scope. The preset was present only as a
  nested Expo dependency.
- Added `babel-preset-expo: ~54.0.12` as a direct development dependency, matching
  Expo's existing preset requirement. Babel configuration and app code were not
  changed. A complete iOS JavaScript export then passed (1,926 modules), and
  Expo Doctor passed 18/18 checks. The export was written to a temporary folder
  (approximately 22 MiB); no native compilation ran locally.
- The free allowance and zero build cost were rechecked before the
  [corrected attempt](https://expo.dev/accounts/rishabh17/projects/Mystash/builds/c22c58ad-80ca-426a-a629-3be40feafaec).
  It **finished successfully** on Expo's worker on 2026-10-26 (India time).
  [Simulator app archive](https://expo.dev/artifacts/eas/4wet0M2N2jmngMwaWsSa5CoZ4oGSXAAeiz_4ef72lyU.tar.gz).
  Both app identifiers and Android settings remain unchanged. The compressed
  archive was later downloaded to temporary storage (33 MiB) and uploaded to
  Appetize; it was not extracted or installed locally.

## Appetize testing

- Uploaded build `b_v6mtdiaegbcphjbt25pdjyvi3y` to the owner's Appetize account.
  The account displayed the Free plan and a 30-minute monthly streaming limit.
  No paid plan was selected.
- [Open the uploaded build](https://appetize.io/app/b_v6mtdiaegbcphjbt25pdjyvi3y).
  Testing used an iPhone 14 Pro Simulator running iOS 17.2.
- Agent checks confirmed launch, feed loading, Search discovery cards, and the
  signed-out Create and Stash screens. One search request returned HTTP 502;
  this was not investigated or changed during the Simulator test.
- The owner subsequently tested the app in Appetize and reported that everything
  was working as expected. This is owner-reported validation, not a claim that
  the agent completed every authenticated flow or physical-device QA.

## References

- [Expo Simulator builds](https://docs.expo.dev/build-reference/simulators/)
- [EAS environment variables](https://docs.expo.dev/eas/environment-variables/)
- [Expo hosted Simulator access](https://docs.expo.dev/preview/simulators/get-started/)
- [Appetize iOS upload format](https://docs.appetize.io/platform/app-management/uploading-apps/ios)
