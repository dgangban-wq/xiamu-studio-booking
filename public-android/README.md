# Public Android build

Independent package `com.studiobooking.publicapp`, version `1.0.2` / code `3`.
Includes the offline author contact dialog and original QR image.
Requires the existing `.android-tools` JDK 21 and Android SDK 36. Source does not
depend on `android-app`, its artwork, its credentials, or customer data.

Run from the repository root with PowerShell:

```powershell
pwsh -NoProfile -File scripts/build-public-signing.ps1 -Initialize
pwsh -NoProfile -File scripts/build-public-android.ps1
node --test tests/public-android.test.js
```

Use PowerShell 7 (`pwsh`) for UTF-8 scripts. The build
installs pinned dependencies from `package-lock.json` using npm (or bundled pnpm
with lockfile import when npm is unavailable), generates
original PNG icons, validates the exact runtime allowlist, injects the compatible
`XiamuNative` bridge, synchronizes Capacitor, builds release, verifies its signature,
and rejects INTERNET permission or incorrect package/version before distribution.
Missing guide/config files cause failure rather than silently omitting them.
Unexpected files in generated web output cause failure, not deletion.

## Signing and recovery

The independent RSA-3072 PKCS12 key lives outside this repository at
`%LOCALAPPDATA%/StudioBookingPublic/signing/public-release.p12`. Its random password
is stored as Windows DPAPI-protected `credentials.clixml`, not plaintext. Directory
ACLs restrict access to this Windows user and SYSTEM. No secret is printed, embedded
in source, passed as a command-line password, or included in distribution.

Initialization creates a hash-verified, restricted recovery copy at
`%USERPROFILE%/.codex/signing-backups/studio-booking-public`. This same-disk copy is
NOT disaster recovery. DPAPI credentials only decrypt for this account on this
machine. Before moving/reinstalling Windows, use a trusted password manager to
securely record the decrypted credential locally, without terminal logging, chat,
screenshots, or source files. Copy the encrypted PKCS12 to encrypted removable
storage and keep the password separately in the password manager. Verify hashes
and test opening the backup with keytool's interactive password prompt. Retain at
least two offline copies in separate secure locations. Never send these files to
app recipients. Never regenerate the key for app updates.

Restore only to a restricted directory outside the source tree. On another machine,
recreate a DPAPI credential with the recovered password using an interactive secure
prompt. Losing both the key and password prevents signing compatible updates.

Direct Gradle builds support `PUBLIC_ANDROID_KEYSTORE`,
`PUBLIC_ANDROID_STORE_PASSWORD`, `PUBLIC_ANDROID_KEY_ALIAS`, and
`PUBLIC_ANDROID_KEY_PASSWORD`; the key must be outside `public-android`. This can
explicitly reference an existing external keystore, but the provided build script
always selects the new public key. Release never falls back to debug signing.

APK verification covers signing, application ID/version, and merged permissions.
`scripts/build-public-verify.ps1` additionally checks the APK runtime allowlist and
15 asset hashes against synchronized runtime and current public sources, accounting
for the intentional bridge injection in `index.html`. The release script invokes
this before copying to distribution. Windows aapt uses a relative APK path to avoid
its Unicode absolute-path limitation.
Real-device installation, native sharing, and back-button behavior still require
device testing. Build logs and validation screenshots are not distributable assets.

CI: run `npm ci --prefix public-android` before `node --test tests/*.test.js`.
When npm is not on PATH, set `PUBLIC_NPM_CLI` to an installed `npm-cli.js`.
Use `-SkipInstall` only after a successful dependency installation. `-PrepareOnly`
synchronizes native assets without compiling or publishing an installer.
