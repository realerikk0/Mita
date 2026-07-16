param([string]$IsNightly = "false")

Write-Host "Cleaning Biyan AutoQA state..."
@("Biyan", "Biyan-nightly") | ForEach-Object {
    Get-Process -Name $_ -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
}
@(
    "$env:APPDATA\Biyan",
    "$env:APPDATA\Biyan-nightly",
    "$env:LOCALAPPDATA\Programs\Biyan",
    "$env:LOCALAPPDATA\Programs\Biyan-nightly"
) | ForEach-Object {
    if (Test-Path $_) { Remove-Item $_ -Recurse -Force -ErrorAction SilentlyContinue }
}
Remove-Item "$env:TEMP\biyan-installer.exe" -Force -ErrorAction SilentlyContinue
