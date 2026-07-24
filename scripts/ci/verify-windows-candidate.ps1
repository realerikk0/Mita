param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Exe,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Msi,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')]
  [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PeMachine {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $stream = [System.IO.File]::Open(
    $Path,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::Read
  )
  $reader = [System.IO.BinaryReader]::new($stream)
  try {
    if ($stream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5A4D) {
      throw "Candidate is not a PE image: $Path"
    }
    $stream.Position = 0x3C
    $peOffset = $reader.ReadInt32()
    if ($peOffset -lt 64 -or ($peOffset + 6) -gt $stream.Length) {
      throw "Candidate has an invalid PE header offset: $Path"
    }
    $stream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x00004550) {
      throw "Candidate has an invalid PE signature: $Path"
    }
    return $reader.ReadUInt16()
  }
  finally {
    $reader.Dispose()
  }
}

function Test-ExpectedFileVersion {
  param(
    [AllowNull()]
    [string]$Value,
    [Parameter(Mandatory = $true)]
    [string]$Expected
  )
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $false
  }
  $pattern = '^' + [regex]::Escape($Expected) + '(?:\.0)?$'
  return $Value.Trim() -match $pattern
}

function Get-MsiProperty {
  param(
    [Parameter(Mandatory = $true)]
    $Database,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $escapedName = $Name.Replace("'", "''")
  $view = $null
  $record = $null
  try {
    $query = "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='$escapedName'"
    $view = $Database.OpenView($query)
    $view.Execute()
    $record = $view.Fetch()
    if ($null -eq $record) {
      throw "MSI property is missing: $Name"
    }
    return [string]$record.StringData(1)
  }
  finally {
    if ($null -ne $record) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record)
    }
    if ($null -ne $view) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
    }
  }
}

function Test-ExtractedBiyanApp {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  $apps = @(
    Get-ChildItem -LiteralPath $Root -File -Recurse |
      Where-Object { $_.Name -ceq 'Biyan.exe' }
  )
  if ($apps.Count -eq 0) {
    throw "$Label candidate does not contain Biyan.exe"
  }

  foreach ($app in $apps) {
    if ((Get-PeMachine -Path $app.FullName) -ne 0x8664) {
      continue
    }
    $versionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($app.FullName)
    if ($versionInfo.ProductName -cne 'Biyan') {
      continue
    }
    if (
      (Test-ExpectedFileVersion -Value $versionInfo.ProductVersion -Expected $Version) -or
      (Test-ExpectedFileVersion -Value $versionInfo.FileVersion -Expected $Version)
    ) {
      return
    }
  }
  throw "$Label candidate has no AMD64 Biyan.exe with version $Version"
}

function Invoke-ExtractedCandidatePolicies {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  $policies = @(
    (Join-Path $PSScriptRoot 'candidate-path-policy.mjs'),
    (Join-Path $PSScriptRoot 'candidate-content-policy.mjs')
  )
  foreach ($policy in $policies) {
    if (-not (Test-Path -LiteralPath $policy -PathType Leaf)) {
      throw "Missing protected candidate policy: $policy"
    }
    & node $policy --root $Root
    if ($LASTEXITCODE -ne 0) {
      throw "$Label candidate failed $(Split-Path -Leaf $policy) (exit $LASTEXITCODE)"
    }
  }
}

$exePath = (Resolve-Path -LiteralPath $Exe).Path
$msiPath = (Resolve-Path -LiteralPath $Msi).Path
foreach ($candidate in @($exePath, $msiPath)) {
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "Missing Windows qualification candidate: $candidate"
  }
  if ((Get-Item -LiteralPath $candidate).Length -le 0) {
    throw "Empty Windows qualification candidate: $candidate"
  }
}

$installerMachine = Get-PeMachine -Path $exePath
if ($installerMachine -notin @(0x014C, 0x8664)) {
  throw ('NSIS installer has unsupported PE machine 0x{0:X4}' -f $installerMachine)
}

$extractRoot = Join-Path `
  ([System.IO.Path]::GetTempPath()) `
  ("biyan-nsis-{0}" -f [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
try {
  $sevenZip = (Get-Command 7z -ErrorAction Stop).Source
  & $sevenZip 'x' "-o$extractRoot" '-y' $exePath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "7-Zip could not extract the NSIS candidate (exit $LASTEXITCODE)"
  }
  Test-ExtractedBiyanApp `
    -Root $extractRoot `
    -Version $Version `
    -Label 'NSIS'
  Invoke-ExtractedCandidatePolicies -Root $extractRoot -Label 'NSIS'
}
finally {
  Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$msiExtractRoot = Join-Path `
  ([System.IO.Path]::GetTempPath()) `
  ("biyan-msi-admin-{0}" -f [guid]::NewGuid().ToString('N'))
$msiLogPath = Join-Path `
  ([System.IO.Path]::GetTempPath()) `
  ("biyan-msi-admin-{0}.log" -f [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $msiExtractRoot | Out-Null
try {
  $msiExec = (Get-Command msiexec.exe -ErrorAction Stop).Source
  & $msiExec `
    '/a' `
    $msiPath `
    '/qn' `
    '/norestart' `
    "TARGETDIR=$msiExtractRoot" `
    '/L*V' `
    $msiLogPath
  $msiExitCode = $LASTEXITCODE
  if ($msiExitCode -ne 0) {
    if (Test-Path -LiteralPath $msiLogPath -PathType Leaf) {
      foreach (
        $line in @(
          Get-Content `
            -LiteralPath $msiLogPath `
            -Tail 80 `
            -ErrorAction SilentlyContinue
        )
      ) {
        [Console]::Error.WriteLine($line)
      }
    }
    throw "Windows Installer could not create the MSI administrative image (exit $msiExitCode)"
  }
  Test-ExtractedBiyanApp `
    -Root $msiExtractRoot `
    -Version $Version `
    -Label 'MSI'
  Invoke-ExtractedCandidatePolicies -Root $msiExtractRoot -Label 'MSI'
}
finally {
  Remove-Item `
    -LiteralPath $msiExtractRoot `
    -Recurse `
    -Force `
    -ErrorAction SilentlyContinue
  Remove-Item `
    -LiteralPath $msiLogPath `
    -Force `
    -ErrorAction SilentlyContinue
}

$windowsInstaller = $null
$database = $null
$summary = $null
try {
  $windowsInstaller = New-Object -ComObject WindowsInstaller.Installer
  $database = $windowsInstaller.OpenDatabase($msiPath, 0)
  $productName = Get-MsiProperty -Database $database -Name 'ProductName'
  $productVersion = Get-MsiProperty -Database $database -Name 'ProductVersion'
  $productCode = Get-MsiProperty -Database $database -Name 'ProductCode'
  if ($productName -cne 'Biyan') {
    throw "MSI ProductName must be Biyan, got: $productName"
  }
  if ($productVersion -cne $Version) {
    throw "MSI ProductVersion must be $Version, got: $productVersion"
  }
  if ($productCode -notmatch '^\{[0-9A-Fa-f-]{36}\}$') {
    throw "MSI ProductCode is invalid: $productCode"
  }

  $summary = $database.SummaryInformation(0)
  $template = [string]$summary.Property(7)
  if ($template -notmatch '^(?i:x64|Intel64)(?:;|$)') {
    throw "MSI Template Summary is not x64: $template"
  }
}
finally {
  foreach ($comObject in @($summary, $database, $windowsInstaller)) {
    if ($null -ne $comObject) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject)
    }
  }
}

Write-Output "Verified Windows AMD64 candidates for Biyan $Version"
