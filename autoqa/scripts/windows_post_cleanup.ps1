param([string]$IsNightly = "false")

@("Biyan", "Biyan-nightly") | ForEach-Object {
    Get-Process -Name $_ -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
}

$installPath = if ($IsNightly -eq "true") {
    "$env:LOCALAPPDATA\Programs\Biyan-nightly"
} else {
    "$env:LOCALAPPDATA\Programs\Biyan"
}
$uninstaller = Join-Path $installPath "uninstall.exe"
if (Test-Path $uninstaller) {
    Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -ErrorAction SilentlyContinue
}
if (Test-Path $installPath) { Remove-Item $installPath -Recurse -Force -ErrorAction SilentlyContinue }
Remove-Item "$env:TEMP\biyan-installer.exe" -Force -ErrorAction SilentlyContinue
