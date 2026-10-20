param(
  [string]$Out = "screen.png",
  [int]$X = 0,
  [int]$Y = 0,
  [int]$Width = 0,
  [int]$Height = 0
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if ([System.IO.Path]::IsPathRooted($Out)) {
  $outPath = $Out
} else {
  $outPath = Join-Path (Join-Path $root "artifacts") $Out
}
$outDir = Split-Path -Parent $outPath
New-Item -ItemType Directory -Force $outDir | Out-Null

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
if ($Width -le 0) { $Width = $screen.Width }
if ($Height -le 0) { $Height = $screen.Height }
if ($X -lt 0) { $X = 0 }
if ($Y -lt 0) { $Y = 0 }

$bmp = New-Object System.Drawing.Bitmap $Width, $Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($X, $Y, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Output $outPath
