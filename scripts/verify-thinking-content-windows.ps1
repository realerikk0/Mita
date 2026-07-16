param(
  [switch]$IncludeTauri,
  [int]$ServerTimeoutSeconds = 180,
  [int]$TauriWarmupSeconds = 600,
  [int]$TauriSettleSeconds = 8,
  [string[]]$TauriProcessNames = @("Biyan")
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
$WebStdoutLog = Join-Path $OutputDir "thinking-content-vite-stdout.log"
$WebStderrLog = Join-Path $OutputDir "thinking-content-vite-stderr.log"
$TauriStdoutLog = Join-Path $OutputDir "thinking-content-tauri-stdout.log"
$TauriStderrLog = Join-Path $OutputDir "thinking-content-tauri-stderr.log"

if (-not ("ThinkingContentWindowTools" -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class ThinkingContentWindowTools {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out ThinkingContentRect rect);
}

[StructLayout(LayoutKind.Sequential)]
public struct ThinkingContentRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
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
    $CommandLine.Contains("Biyan-thinking-content-test") -or
    $CommandLine.Contains("verify-thinking-content") -or
    $CommandLine.Contains("dev:web") -or
    $CommandLine.Contains("thinking-content-demo") -or
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

function Test-HasMsvcLinker {
  $linkCommand = Get-Command "link.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  return $null -ne $linkCommand -and $linkCommand.Source -match "\\MSVC\\.*\\link\.exe$"
}

function Import-VisualStudioDevEnvironment {
  if (Test-HasMsvcLinker) {
    return
  }

  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio/Installer/vswhere.exe"
  if (-not (Test-Path $vswhere)) {
    Write-Host "VS Build Tools lookup skipped: vswhere.exe was not found."
    return
  }

  $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if ([string]::IsNullOrWhiteSpace($installPath)) {
    Write-Host "VS Build Tools lookup skipped: no VC tools installation found."
    return
  }

  $vcvars = Join-Path $installPath "VC/Auxiliary/Build/vcvars64.bat"
  if (-not (Test-Path $vcvars)) {
    Write-Host "VS Build Tools lookup skipped: missing vcvars64.bat at $vcvars"
    return
  }

  Write-Host "Importing Visual Studio Build Tools environment from $vcvars"
  & cmd.exe /s /c "`"$vcvars`" >nul && set" | ForEach-Object {
    if ($_ -match "^(.*?)=(.*)$") {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
    }
  }

  if (Test-HasMsvcLinker) {
    Write-Host "Using MSVC linker: $((Get-Command 'link.exe').Source)"
  } else {
    Write-Host "MSVC linker still unavailable after importing Visual Studio environment."
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
  param([int]$TimeoutSeconds, [System.Diagnostics.Process]$TauriProcess)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($null -ne $TauriProcess) {
      $TauriProcess.Refresh()
      if ($TauriProcess.HasExited) {
        throw "Tauri dev exited before screenshot capture. Exit code: $($TauriProcess.ExitCode)"
      }
    }

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

function Test-TauriScreenshotContainsRenderedContent {
  param([string]$Path, [IntPtr]$WindowHandle)

  Add-Type -AssemblyName System.Drawing

  $rect = New-Object ThinkingContentRect
  if (-not [ThinkingContentWindowTools]::GetWindowRect($WindowHandle, [ref]$rect)) {
    throw "Unable to read Windows Tauri window bounds for screenshot validation."
  }

  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $left = [Math]::Max(0, $rect.Left + 24)
    $top = [Math]::Max(0, $rect.Top + 80)
    $right = [Math]::Min($bitmap.Width - 1, $rect.Right - 24)
    $bottom = [Math]::Min($bitmap.Height - 1, $rect.Bottom - 24)

    if ($right -le $left -or $bottom -le $top) {
      throw "Unable to sample Windows Tauri screenshot content area."
    }

    [int]$stepX = [Math]::Max(1, [Math]::Floor(($right - $left) / 32))
    [int]$stepY = [Math]::Max(1, [Math]::Floor(($bottom - $top) / 24))
    $darkPixels = 0
    $totalPixels = 0

    for ($y = $top; $y -le $bottom; $y += $stepY) {
      for ($x = $left; $x -le $right; $x += $stepX) {
        $pixel = $bitmap.GetPixel($x, $y)
        $luminance = (0.2126 * $pixel.R) + (0.7152 * $pixel.G) + (0.0722 * $pixel.B)
        if ($luminance -lt 120) {
          $darkPixels += 1
        }
        $totalPixels += 1
      }
    }

    if ($totalPixels -eq 0) {
      throw "Unable to sample Windows Tauri screenshot pixels."
    }

    $darkRatio = $darkPixels / $totalPixels
    Write-Host ("Windows Tauri screenshot dark pixel ratio: {0:P1} ({1}/{2})" -f $darkRatio, $darkPixels, $totalPixels)

    if ($darkRatio -lt 0.08) {
      throw "Windows Tauri screenshot appears blank or did not render the dark thinking content demo."
    }
  } finally {
    $bitmap.Dispose()
  }
}

function Write-FileTail {
  param([string]$Path, [int]$Lines = 80)

  if (-not (Test-Path $Path)) {
    Write-Host "  Missing log: $Path"
    return
  }

  Write-Host "  Tail of $Path"
  Get-Content -Path $Path -Tail $Lines | ForEach-Object {
    Write-Host "    $_"
  }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $WebStdoutLog, $WebStderrLog, $TauriStdoutLog, $TauriStderrLog
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

  Import-VisualStudioDevEnvironment

  Write-Host "Preparing core workspace build for Vite aliases..."
  yarn workspace @biyan/core build
  if ($LASTEXITCODE -ne 0) {
    throw "yarn workspace @biyan/core build failed with exit code $LASTEXITCODE"
  }

  Stop-RepoPortOwner -Port 1420

  Write-Host "Starting Vite demo server for thinking content verification..."
  $webProcess = Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/c", "yarn dev:web") `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $WebStdoutLog `
    -RedirectStandardError $WebStderrLog `
    -PassThru `
    -WindowStyle Minimized

  Start-Sleep -Milliseconds 500
  if ($webProcess.HasExited) {
    Write-FileTail -Path $WebStdoutLog
    Write-FileTail -Path $WebStderrLog
    throw "Vite demo server exited before readiness check. Exit code: $($webProcess.ExitCode)"
  }

  Wait-ForDemo -Url $DemoUrl -TimeoutSeconds $ServerTimeoutSeconds

  Write-Host "Running Edge/WebView2-compatible browser verification..."
  $env:THINKING_CONTENT_DEMO_URL = $DemoUrl
  $env:THINKING_CONTENT_OUTPUT_DIR = $OutputDir
  $env:THINKING_CONTENT_READY_TIMEOUT_MS = "180000"
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

    Write-Host "Preparing Windows Tauri icon assets..."
    yarn build:icon
    if ($LASTEXITCODE -ne 0) {
      throw "yarn build:icon failed with exit code $LASTEXITCODE"
    }

    $tauriProcess = Start-Process -FilePath "cmd.exe" `
      -ArgumentList @("/c", "yarn dev:thinking-content:tauri") `
      -WorkingDirectory $RepoRoot `
      -RedirectStandardOutput $TauriStdoutLog `
      -RedirectStandardError $TauriStderrLog `
      -PassThru `
      -WindowStyle Minimized

    try {
      if ($tauriProcess.HasExited) {
        Write-FileTail -Path $TauriStdoutLog
        Write-FileTail -Path $TauriStderrLog
        throw "Tauri dev exited before screenshot capture. Exit code: $($tauriProcess.ExitCode)"
      }

      $tauriWindow = Wait-ForTauriWindow -TimeoutSeconds $TauriWarmupSeconds -TauriProcess $tauriProcess
      Write-Host "Foregrounded Windows Tauri window: $($tauriWindow.ProcessName) (PID $($tauriWindow.Id))"
      if ($TauriSettleSeconds -gt 0) {
        Write-Host "Waiting $TauriSettleSeconds seconds for Windows WebView content to settle..."
        Start-Sleep -Seconds $TauriSettleSeconds
        $tauriWindow.Refresh()
        [ThinkingContentWindowTools]::ShowWindowAsync($tauriWindow.MainWindowHandle, 5) | Out-Null
        [ThinkingContentWindowTools]::SetForegroundWindow($tauriWindow.MainWindowHandle) | Out-Null
        Start-Sleep -Milliseconds 500
      }
      Save-DesktopScreenshot -Path $TauriScreenshot
      Test-TauriScreenshotContainsRenderedContent -Path $TauriScreenshot -WindowHandle $tauriWindow.MainWindowHandle
      Write-Host "Saved Windows Tauri screenshot: $TauriScreenshot"
    } finally {
      Stop-ProcessTree -Process $tauriProcess
    }
  }

  Write-Host "Evidence package:"
  Write-Host "  Log: $VerificationLog"
  Write-Host "  Vite stdout log: $WebStdoutLog"
  Write-Host "  Vite stderr log: $WebStderrLog"
  Write-Host "  Tauri stdout log: $TauriStdoutLog"
  Write-Host "  Tauri stderr log: $TauriStderrLog"
  Write-Host "  Browser desktop screenshot: $BrowserDesktopScreenshot"
  Write-Host "  Browser mobile screenshot: $BrowserMobileScreenshot"
  if ($IncludeTauri) {
    Write-Host "  Windows Tauri screenshot: $TauriScreenshot"
  }
} finally {
  Stop-ProcessTree -Process $webProcess
  Write-Host "Vite server logs:"
  Write-FileTail -Path $WebStdoutLog
  Write-FileTail -Path $WebStderrLog
  if ($IncludeTauri) {
    Write-Host "Tauri dev logs:"
    Write-FileTail -Path $TauriStdoutLog
    Write-FileTail -Path $TauriStderrLog
  }
  if ($transcriptStarted) {
    Stop-Transcript | Out-Null
  }
}

Write-Host "Thinking content Windows verification completed."
