param(
  [switch]$IncludeTauri,
  [int]$ServerTimeoutSeconds = 90,
  [int]$TauriWarmupSeconds = 90,
  [int]$TauriSettleSeconds = 8,
  [string[]]$TauriProcessNames = @("Biyan")
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

if (-not ("LoadingRibbonWindowTools" -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class LoadingRibbonWindowTools {
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

function Get-ProcessCommandLine {
  param([int]$ProcessId)

  try {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
    return $processInfo.CommandLine
  } catch {
    return ""
  }
}

function Test-IsRepoVerificationProcess {
  param([string]$CommandLine)

  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return $false
  }

  return (
    $CommandLine.Contains($RepoRoot) -or
    $CommandLine.Contains("Biyan-loading-ribbon-test") -or
    $CommandLine.Contains("verify-loading-ribbon") -or
    $CommandLine.Contains("dev:web") -or
    $CommandLine.Contains("loading-ribbon-demo") -or
    $CommandLine.Contains("tauri dev")
  )
}

function Stop-RepoPortOwner {
  param([int]$Port)

  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

  foreach ($ownerProcessId in $listeners) {
    if ($ownerProcessId -eq $PID -or $ownerProcessId -eq 0) {
      continue
    }

    $commandLine = Get-ProcessCommandLine -ProcessId $ownerProcessId
    if (-not (Test-IsRepoVerificationProcess -CommandLine $commandLine)) {
      throw "Port $Port is already in use by unrelated process PID $ownerProcessId. Command line: $commandLine"
    }

    $process = Get-Process -Id $ownerProcessId -ErrorAction SilentlyContinue
    if ($null -ne $process) {
      Write-Host "Stopping stale repo verification process on port ${Port}: $($process.ProcessName) PID $ownerProcessId"
      Stop-ProcessTree -Process $process
    }
  }
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
      Sort-Object StartTime -Descending |
      Select-Object -First 1

    if ($null -ne $process) {
      [LoadingRibbonWindowTools]::ShowWindowAsync($process.MainWindowHandle, 9) | Out-Null
      [LoadingRibbonWindowTools]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
      return $process
    }

    Start-Sleep -Seconds 1
  }

  throw "Timed out waiting for a visible Tauri window named $($TauriProcessNames -join ', ')"
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

function Assert-ScreenshotLooksNonBlank {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    throw "Screenshot was not created: $Path"
  }

  $file = Get-Item $Path
  if ($file.Length -lt 10000) {
    throw "Screenshot looks empty: $Path is only $($file.Length) bytes"
  }

  Add-Type -AssemblyName System.Drawing
  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)

  try {
    $colors = New-Object 'System.Collections.Generic.HashSet[string]'
    $stepX = [Math]::Max(1, [Math]::Floor($bitmap.Width / 32))
    $stepY = [Math]::Max(1, [Math]::Floor($bitmap.Height / 32))

    for ($x = 0; $x -lt $bitmap.Width; $x += $stepX) {
      for ($y = 0; $y -lt $bitmap.Height; $y += $stepY) {
        $pixel = $bitmap.GetPixel($x, $y)
        $colors.Add("$($pixel.R),$($pixel.G),$($pixel.B)") | Out-Null
      }
    }

    if ($colors.Count -lt 8) {
      throw "Screenshot looks blank or single-color: sampled only $($colors.Count) colors"
    }
  } finally {
    $bitmap.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Set-Location $RepoRoot
Stop-RepoPortOwner -Port 1420

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
      Wait-ForTauriWindow -TimeoutSeconds $TauriWarmupSeconds | Out-Null
      Start-Sleep -Seconds $TauriSettleSeconds
      if ($tauriProcess.HasExited) {
        throw "Tauri dev exited before screenshot capture. Exit code: $($tauriProcess.ExitCode)"
      }

      Save-DesktopScreenshot -Path $TauriScreenshot
      Assert-ScreenshotLooksNonBlank -Path $TauriScreenshot
      Write-Host "Saved Windows Tauri screenshot: $TauriScreenshot"
    } finally {
      Stop-ProcessTree -Process $tauriProcess
    }
  }
} finally {
  Stop-ProcessTree -Process $webProcess
}

Write-Host "Loading ribbon Windows verification completed."
