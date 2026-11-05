param([string]$ApkPath)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$project = Join-Path $root 'public-android'
if (!$ApkPath) { $ApkPath = Join-Path $project 'android/app/build/outputs/apk/release/app-release.apk' }
$files = @('index.html','app.js','config.js','config-ui.js','styles.css','lucide.min.js','icon.png','one-page-guide.svg','使用说明.html','一图流.html','manifest.webmanifest','sw.js','contact.js','author-contact.png')
$allowed = @($files) + @('native-bridge.js','cordova.js','cordova_plugins.js')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($ApkPath)
try {
    foreach ($entry in $zip.Entries) {
        if ($entry.FullName.StartsWith('assets/public/') -and !$entry.FullName.EndsWith('/')) {
            $name = $entry.FullName.Substring('assets/public/'.Length)
            if ($name -notin $allowed) { throw "Unexpected APK runtime asset: $name" }
        }
        if ($entry.FullName -match '\.(p12|jks|keystore|clixml|pem)$') { throw 'Forbidden signing material in APK.' }
    }
    foreach ($name in @($files) + @('native-bridge.js')) {
        $local = Join-Path $project "www/$name"
        $entry = $zip.GetEntry("assets/public/$name")
        if (!$entry) { throw "Missing APK runtime asset: $name" }
        $stream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $actual = [Convert]::ToHexString($sha.ComputeHash($stream)) }
        finally { $stream.Dispose(); $sha.Dispose() }
        if ($actual -ne (Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash) {
            throw "Packaged asset does not match synchronized runtime: $name"
        }
        if ($name -eq 'native-bridge.js') { continue }
        $source = Join-Path $root "public-app/$name"
        if ($name -eq 'index.html') {
            $original = [IO.File]::ReadAllText($source)
            $synced = [IO.File]::ReadAllText($local).Replace("<script src=`"./native-bridge.js`"></script>`n", '')
            if ($original -cne $synced) { throw 'Source index.html changed after synchronization.' }
        } elseif ($actual -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash) {
            throw "Source changed after synchronization: $name"
        }
    }
    Write-Host "APK runtime allowlist and all $($files.Count + 1) resource hashes verified against final sources."
} finally { $zip.Dispose() }
