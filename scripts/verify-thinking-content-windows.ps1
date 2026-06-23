param(
  [switch]$IncludeTauri,
  [int]$ServerTimeoutSeconds = 90,
  [int]$TauriWarmupSeconds = 20,
  [string[]]$TauriProcessNames = @("Biyan", "Mita")
)

$ErrorActionPreference = "Stop"

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
  throw "This verifier must run on Windows with Microsoft Edge/WebView2 available."
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$OutputDir = Join-Path $RepoRoot "output/playwright"
$DemoUrl = "http://localhost:1420/thinking-content-demo"
$TauriConfigPath = Join-Path $RepoRoot "scripts/thinking-content-tauri-demo.config.json"
$BrowserDesktopScreenshot = Join-Path $OutputDir "thinking-content-demo-desktop.png"
$BrowserMobileScreenshot = Join-Path $OutputDir "thinking-content-demo-mobile.png"
$TauriScreenshot = Join-Path $OutputDir "thinking-content-tauri-windows.png"
$VerificationLog = Join-Path $OutputDir "thinking-content-windows-verification.log"

if (-not ("ThinkingContentWindowTools" -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class ThinkingContentWindowTools {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
}

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

function Wait-ForTauriWindow {
  param([int]$TimeoutSeconds)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $process = Get-Process -Name $TauriProcessNames -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 } |
      Select-Object -First 1

    if ($null -ne $process) {
      [ThinkingContentWindowTools]::ShowWindowAsync($process.MainWindowHandle, 5) | Out-Null
      [ThinkingContentWindowTools]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
      Start-Sleep -Milliseconds 500
      return $process
    }

    Start-Sleep -Milliseconds 500
  }

  throw "Timed out waiting for focused Windows Tauri window. Looked for process names: $($TauriProcessNames -join ', ')"
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
$transcriptStarted = $false
$webProcess = $null

try {
  Start-Transcript -Path $VerificationLog -Force | Out-Null
  $transcriptStarted = $true
} catch {
  Write-Warning "Unable to start transcript at ${VerificationLog}: $_"
}

try {
  Set-Location $RepoRoot

  Write-Host "Starting Vite demo server for thinking content verification..."
  $webProcess = Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/c", "yarn dev:web") `
    -WorkingDirectory $RepoRoot `
    -PassThru `
    -WindowStyle Minimized

  Wait-ForDemo -Url $DemoUrl -TimeoutSeconds $ServerTimeoutSeconds

  Write-Host "Running Edge/WebView2-compatible browser verification..."
  $env:THINKING_CONTENT_DEMO_URL = $DemoUrl
  $env:THINKING_CONTENT_OUTPUT_DIR = $OutputDir
  $env:PLAYWRIGHT_CHANNEL = "msedge"
  yarn verify:thinking-content
  if ($LASTEXITCODE -ne 0) {
    throw "yarn verify:thinking-content failed with exit code $LASTEXITCODE"
  }

  if ($IncludeTauri) {
    Write-Host "Launching focused Windows Tauri shell for visual screenshot..."
    if (-not (Test-Path $TauriConfigPath)) {
      throw "Missing Tauri demo config: $TauriConfigPath"
    }

    $tauriProcess = Start-Process -FilePath "cmd.exe" `
      -ArgumentList @("/c", "yarn dev:thinking-content:tauri") `
      -WorkingDirectory $RepoRoot `
      -PassThru

    try {
      if ($tauriProcess.HasExited) {
        throw "Tauri dev exited before screenshot capture. Exit code: $($tauriProcess.ExitCode)"
      }

      $tauriWindow = Wait-ForTauriWindow -TimeoutSeconds $TauriWarmupSeconds
      Write-Host "Foregrounded Windows Tauri window: $($tauriWindow.ProcessName) (PID $($tauriWindow.Id))"
      Save-DesktopScreenshot -Path $TauriScreenshot
      Write-Host "Saved Windows Tauri screenshot: $TauriScreenshot"
    } finally {
      Stop-ProcessTree -Process $tauriProcess
    }
  }

  Write-Host "Evidence package:"
  Write-Host "  Log: $VerificationLog"
  Write-Host "  Browser desktop screenshot: $BrowserDesktopScreenshot"
  Write-Host "  Browser mobile screenshot: $BrowserMobileScreenshot"
  if ($IncludeTauri) {
    Write-Host "  Windows Tauri screenshot: $TauriScreenshot"
  }
} finally {
  Stop-ProcessTree -Process $webProcess
  if ($transcriptStarted) {
    Stop-Transcript | Out-Null
  }
}

Write-Host "Thinking content Windows verification completed."
