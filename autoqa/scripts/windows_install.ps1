param([string]$IsNightly = "false")

$installerPath = "$env:TEMP\biyan-installer.exe"
if (!(Test-Path $installerPath)) { throw "Biyan installer not found: $installerPath" }

Write-Host "Installing Biyan..."
$process = Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Biyan installer exited with $($process.ExitCode)" }

if ($IsNightly -eq "true") {
    $appPath = "$env:LOCALAPPDATA\Programs\Biyan-nightly\Biyan-nightly.exe"
    $processName = "Biyan-nightly.exe"
} else {
    $appPath = "$env:LOCALAPPDATA\Programs\Biyan\Biyan.exe"
    $processName = "Biyan.exe"
}
if (!(Test-Path $appPath)) { throw "Biyan executable not found: $appPath" }

"BIYAN_APP_PATH=$appPath" | Out-File -FilePath $env:GITHUB_ENV -Append
"BIYAN_PROCESS_NAME=$processName" | Out-File -FilePath $env:GITHUB_ENV -Append
Write-Host "Biyan installed at $appPath"
