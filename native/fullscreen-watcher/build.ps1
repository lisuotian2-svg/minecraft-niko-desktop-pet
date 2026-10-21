# Build the Niko Pet 3D foreground-fullscreen watcher.
# Uses the Windows .NET Framework compiler that ships with Windows 11; no NuGet
# or network access is required.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $root 'Program.cs'
$outDir = Join-Path $root 'bin'
$output = Join-Path $outDir 'FullscreenWatcher.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path $csc)) {
  throw "csc.exe not found: $csc"
}
if (-not (Test-Path $source)) {
  throw "source not found: $source"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

& $csc /nologo /target:exe /platform:x64 /optimize+ /out:$output $source
if ($LASTEXITCODE -ne 0) {
  throw "csc failed with exit code $LASTEXITCODE"
}
if (-not (Test-Path $output)) {
  throw "build did not produce $output"
}

Write-Host "Built $output"
