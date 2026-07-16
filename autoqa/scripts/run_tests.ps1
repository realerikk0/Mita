param(
    [string]$BiyanAppPath,
    [string]$ProcessName,
    [string]$RpToken
)

$arguments = @("main.py", "--enable-reportportal", "--rp-token", $RpToken)
if ($BiyanAppPath) { $arguments += @("--biyan-app-path", $BiyanAppPath) }
if ($ProcessName) { $arguments += @("--biyan-process-name", $ProcessName) }
python @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
