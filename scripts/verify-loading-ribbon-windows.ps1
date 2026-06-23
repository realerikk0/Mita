param(
  [switch]$IncludeTauri,
  [int]$ServerTimeoutSeconds = 90,
  [int]$TauriWarmupSeconds = 20
)

$ErrorActionPreference = "Stop"

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
  throw "This verifier must run on Windows with Microsoft Edge/WebView2 available."
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$OutputDir = Join-Path $RepoRoot "output/playwright"
$DemoUrl = "http://localhost:1420/loading-ribbon-demo"
$TauriConfigPath = Join-Path $RepoRoot "scripts/loading-ribbon-tauri-demo.config.json"
$TauriScreenshot = Join-Path $OutputDir "loading-ribbon-tauri-windows.png"

function Stop-ProcessTree {
  param([System.Diagnostics.Process]$Process)

  if ($null -eq $Process -or $Process.HasExited) {
    return
  }

  & taskkill.exe /PID $Process.Id /T /F | Out-Null
}

function Wait-ForDemo {
  param([string]$Url, [int]$TimeoutSeconds)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 750
    }
  }

  throw "Timed out waiting for $Url"
}

function Save-DesktopScreenshot {
  param([string]$Path)

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Set-Location $RepoRoot

Write-Host "Starting Vite demo server for loading ribbon verification..."
$webProcess = Start-Process -FilePath "cmd.exe" `
  -ArgumentList @("/c", "yarn dev:web") `
  -WorkingDirectory $RepoRoot `
  -PassThru `
  -WindowStyle Minimized

try {
  Wait-ForDemo -Url $DemoUrl -TimeoutSeconds $ServerTimeoutSeconds

  Write-Host "Running Edge/WebView2-compatible browser verification..."
  $env:LOADING_RIBBON_DEMO_URL = $DemoUrl
  $env:PLAYWRIGHT_CHANNEL = "msedge"
  yarn verify:loading-ribbon
  if ($LASTEXITCODE -ne 0) {
    throw "yarn verify:loading-ribbon failed with exit code $LASTEXITCODE"
  }

  if ($IncludeTauri) {
    Write-Host "Launching focused Windows Tauri shell for visual screenshot..."
    if (-not (Test-Path $TauriConfigPath)) {
      throw "Missing Tauri demo config: $TauriConfigPath"
    }

    $tauriProcess = Start-Process -FilePath "cmd.exe" `
      -ArgumentList @("/c", "yarn dev:loading-ribbon:tauri") `
      -WorkingDirectory $RepoRoot `
      -PassThru

    try {
      Start-Sleep -Seconds $TauriWarmupSeconds
      if ($tauriProcess.HasExited) {
        throw "Tauri dev exited before screenshot capture. Exit code: $($tauriProcess.ExitCode)"
      }

      Save-DesktopScreenshot -Path $TauriScreenshot
      Write-Host "Saved Windows Tauri screenshot: $TauriScreenshot"
    } finally {
      Stop-ProcessTree -Process $tauriProcess
    }
  }
} finally {
  Stop-ProcessTree -Process $webProcess
}

Write-Host "Loading ribbon Windows verification completed."
