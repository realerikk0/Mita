param(
    [string]$WorkflowInputUrl,
    [string]$WorkflowInputIsNightly,
    [string]$RepoVariableUrl,
    [string]$RepoVariableIsNightly,
    [string]$DefaultUrl,
    [string]$DefaultIsNightly
)

$biyanAppUrl = $WorkflowInputUrl
$isNightly = $WorkflowInputIsNightly
if ([string]::IsNullOrWhiteSpace($biyanAppUrl)) {
    $biyanAppUrl = $RepoVariableUrl
    $isNightly = $RepoVariableIsNightly
}
if ([string]::IsNullOrWhiteSpace($biyanAppUrl)) {
    $biyanAppUrl = $DefaultUrl
    $isNightly = $DefaultIsNightly
}
if ([string]::IsNullOrWhiteSpace($biyanAppUrl)) {
    throw "No Biyan installer URL was provided"
}

$downloadPath = "$env:TEMP\biyan-installer.exe"
Write-Host "Downloading Biyan from: $biyanAppUrl"
Invoke-WebRequest -Uri $biyanAppUrl -OutFile $downloadPath -UseBasicParsing
if (!(Test-Path $downloadPath) -or (Get-Item $downloadPath).Length -eq 0) {
    throw "Biyan installer download is empty"
}
"BIYAN_APP_URL=$biyanAppUrl" | Out-File -FilePath $env:GITHUB_ENV -Append
"IS_NIGHTLY=$isNightly" | Out-File -FilePath $env:GITHUB_ENV -Append
Write-Host "Downloaded Biyan installer to $downloadPath"
