param([switch]$PrepareOnly, [switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$project = Join-Path $root 'public-android'
$jdk = Get-ChildItem (Join-Path $root '.android-tools/jdk') -Directory | Select-Object -First 1
$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = Join-Path $root '.android-tools/sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:Path = "$env:JAVA_HOME/bin;$env:Path"
$pnpm = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm.cmd'
Push-Location $project
try {
    if (!$SkipInstall) {
        if ($env:PUBLIC_NPM_CLI) {
            & node $env:PUBLIC_NPM_CLI ci --no-audit --no-fund
        } elseif (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
            & npm.cmd ci --no-audit --no-fund
        } else {
            & $pnpm import
            if ($LASTEXITCODE -ne 0) { throw 'Lockfile import failed.' }
            & $pnpm install --frozen-lockfile --fetch-timeout 300000
        }
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & node scripts/generate-icons.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Icon generation failed.' }
    & node scripts/sync-web.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Public runtime assets incomplete or unsafe.' }
    & node node_modules/@capacitor/cli/bin/capacitor sync android
    if ($LASTEXITCODE -ne 0) { throw 'Capacitor synchronization failed.' }
    if ($PrepareOnly) { return }
    . (Join-Path $PSScriptRoot 'build-public-signing.ps1')
    Push-Location android
    try {
        & ./gradlew.bat --no-daemon --console=plain assembleRelease
        if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' }
    } finally { Pop-Location }
    $apk = Join-Path $project 'android/app/build/outputs/apk/release/app-release.apk'
    # aapt on Windows cannot reliably decode non-ASCII absolute paths.
    $apkRelative = 'android/app/build/outputs/apk/release/app-release.apk'
    $buildTools = Join-Path $env:ANDROID_HOME 'build-tools/36.0.0'
    & (Join-Path $buildTools 'apksigner.bat') verify --verbose $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $permissions = & (Join-Path $buildTools 'aapt.exe') dump permissions $apkRelative
    if ($LASTEXITCODE -ne 0 -or ($permissions -match 'android.permission.INTERNET')) { throw 'APK permission audit failed.' }
    $badging = & (Join-Path $buildTools 'aapt.exe') dump badging $apkRelative
    if ($LASTEXITCODE -ne 0 -or !($badging -match "package: name='com.studiobooking.publicapp' versionCode='4' versionName='1\.1\.0'")) { throw 'APK package identity audit failed.' }
    if ($badging -match 'application-debuggable') { throw 'Release APK must not be debuggable.' }
    & (Join-Path $PSScriptRoot 'build-public-verify.ps1') -ApkPath $apk
    $distribution = Join-Path $root 'public-distribution'
    New-Item -ItemType Directory -Force $distribution | Out-Null
    $installer = Join-Path $distribution '摄影棚预约管理-v1.1.0.apk'
    Copy-Item -LiteralPath $apk -Destination $installer
    Copy-Item -LiteralPath (Join-Path $project '安装说明.txt') -Destination (Join-Path $distribution '安卓安装说明.txt')
    $hash = (Get-FileHash $installer -Algorithm SHA256).Hash
    Write-Host "Signed public APK ready. SHA256: $hash"
} finally {
    Pop-Location
    foreach ($name in @('PUBLIC_ANDROID_KEYSTORE','PUBLIC_ANDROID_KEY_ALIAS','PUBLIC_ANDROID_STORE_PASSWORD','PUBLIC_ANDROID_KEY_PASSWORD')) {
        Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
}
