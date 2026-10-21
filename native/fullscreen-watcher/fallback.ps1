# PowerShell fallback for the C# fullscreen watcher (used only when the
# prebuilt helper is missing or cannot start). It compiles the same detection
# logic through Add-Type once, then prints one JSON line per poll.
param(
  [switch]$Once,
  [int]$IntervalMs = 750,
  [int]$ExcludePid = -1,
  [string]$ExcludeProcesses = '',
  [string]$ExcludeClasses = ''
)

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'Program.cs'
if (-not (Test-Path $source)) {
  throw "Program.cs not found next to fallback.ps1: $source"
}

Add-Type -Path $source -ErrorAction Stop
[NikoFullscreen.Probe]::Configure($ExcludePid, $ExcludeProcesses, $ExcludeClasses)

if ($Once) {
  [Console]::Out.WriteLine([NikoFullscreen.Probe]::JsonOnce())
  [Console]::Out.Flush()
  exit 0
}

while ($true) {
  try {
    [Console]::Out.WriteLine([NikoFullscreen.Probe]::JsonOnce())
    [Console]::Out.Flush()
  } catch {
    [Console]::Out.WriteLine('{"kind":"error","message":"' + ($_.Exception.GetType().Name) + '"}')
    [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds ([Math]::Max(250, $IntervalMs))
}
