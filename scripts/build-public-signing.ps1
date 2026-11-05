param([switch]$Initialize)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$homeDir = Join-Path $env:LOCALAPPDATA 'StudioBookingPublic/signing'
$backupDir = Join-Path $env:USERPROFILE '.codex/signing-backups/studio-booking-public'
$credentials = Join-Path $homeDir 'credentials.clixml'
$keyPath = Join-Path $homeDir 'public-release.p12'
if ($Initialize -and !(Test-Path -LiteralPath $credentials)) {
    if (Test-Path -LiteralPath $keyPath) { throw 'Existing key found without credentials; recover credentials, do not replace key.' }
    foreach ($dir in @($homeDir, $backupDir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls.exe $dir /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict signing directory permissions.' }
    }
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $password = [Convert]::ToBase64String($bytes)
    $secure = ConvertTo-SecureString $password -AsPlainText -Force
    $credential = [PSCredential]::new('public-release', $secure)
    # Windows DPAPI binds stored credentials to this Windows account and machine.
    $credential | Export-Clixml -LiteralPath $credentials
    $env:PUBLIC_ANDROID_STORE_PASSWORD = $password
    try {
        $jdk = Get-ChildItem (Join-Path $root '.android-tools/jdk') -Directory | Select-Object -First 1
        & (Join-Path $jdk.FullName 'bin/keytool.exe') -genkeypair -noprompt -storetype PKCS12 -keystore $keyPath -alias public-release -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Studio Booking Public, O=Studio Booking, C=CN' -storepass:env PUBLIC_ANDROID_STORE_PASSWORD -keypass:env PUBLIC_ANDROID_STORE_PASSWORD
        if ($LASTEXITCODE -ne 0) { throw 'Public signing key generation failed.' }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backupKey = Join-Path $backupDir "public-release-$stamp.p12"
        Copy-Item -LiteralPath $keyPath -Destination $backupKey
        Copy-Item -LiteralPath $credentials -Destination (Join-Path $backupDir "credentials-$stamp.clixml")
        if ((Get-FileHash $keyPath).Hash -ne (Get-FileHash $backupKey).Hash) { throw 'Signing backup verification failed.' }
        Write-Host 'Independent signing key initialized. Restricted local recovery copy verified; offline backup still required.'
    } finally { Remove-Item Env:PUBLIC_ANDROID_STORE_PASSWORD -ErrorAction SilentlyContinue; $password = $null }
}
if (!(Test-Path -LiteralPath $credentials) -or !(Test-Path -LiteralPath $keyPath)) {
    throw 'Missing independent signing key. Run scripts/build-public-signing.ps1 -Initialize first.'
}
$credential = Import-Clixml -LiteralPath $credentials
$env:PUBLIC_ANDROID_KEYSTORE = $keyPath
$env:PUBLIC_ANDROID_KEY_ALIAS = $credential.UserName
$env:PUBLIC_ANDROID_STORE_PASSWORD = $credential.GetNetworkCredential().Password
$env:PUBLIC_ANDROID_KEY_PASSWORD = $env:PUBLIC_ANDROID_STORE_PASSWORD
