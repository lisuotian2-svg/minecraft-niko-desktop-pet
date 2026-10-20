param(
  [string]$MinecraftRoot = (Join-Path $env:APPDATA ".minecraft"),
  [string]$Jar = (Join-Path $env:APPDATA ".minecraft\versions\1.20.1-Fabric 0.19.5\1.20.1-Fabric 0.19.5.jar"),
  [string]$OutRoot = (Join-Path $PSScriptRoot "..\public\assets\vanilla")
)

$ErrorActionPreference = "Stop"
$indexPath = Join-Path $MinecraftRoot "assets\indexes\5.json"
$index = Get-Content $indexPath -Raw | ConvertFrom-Json
$keys = $index.objects.PSObject.Properties.Name
$entries = @()

$soundKeys = @(
  "minecraft/sounds/step/grass1.ogg",
  "minecraft/sounds/step/grass2.ogg",
  "minecraft/sounds/step/grass3.ogg",
  "minecraft/sounds/step/grass4.ogg",
  "minecraft/sounds/step/grass5.ogg",
  "minecraft/sounds/step/grass6.ogg",
  "minecraft/sounds/mob/cat/purr1.ogg",
  "minecraft/sounds/mob/cat/purr2.ogg",
  "minecraft/sounds/mob/cat/purr3.ogg",
  "minecraft/sounds/mob/cat/purreow1.ogg",
  "minecraft/sounds/mob/cat/meow1.ogg",
  "minecraft/sounds/mob/cat/eat1.ogg",
  "minecraft/sounds/mob/cat/eat2.ogg",
  "minecraft/sounds/random/burp.ogg",
  "minecraft/sounds/fire/ignite.ogg",
  "minecraft/sounds/fire/fire.ogg",
  "minecraft/sounds/block/candle/extinguish1.ogg",
  "minecraft/sounds/mob/endermen/portal.ogg",
  "minecraft/sounds/portal/travel.ogg",
  "minecraft/sounds/random/click.ogg"
)

foreach ($key in $soundKeys) {
  if ($keys -notcontains $key) { throw "missing sound key: $key" }
  $hash = $index.objects.$key.hash
  $src = Join-Path $MinecraftRoot ("assets\objects\" + $hash.Substring(0, 2) + "\" + $hash)
  if (-not (Test-Path $src)) { throw "missing sound object: $src" }
  $rel = $key -replace '^minecraft/sounds/', ''
  $dst = Join-Path $OutRoot ("sounds\" + $rel)
  New-Item -ItemType Directory -Force (Split-Path -Parent $dst) | Out-Null
  Copy-Item $src $dst -Force
  $entries += [pscustomobject]@{ kind = "sound"; key = $key; sha1 = $hash; file = "sounds/$rel"; bytes = (Get-Item $dst).Length }
}

$textureKeys = @(
  "assets/minecraft/textures/item/bread.png",
  "assets/minecraft/textures/block/torch.png",
  "assets/minecraft/textures/particle/heart.png",
  "assets/minecraft/textures/particle/flame.png"
)
for ($i = 0; $i -lt 8; $i++) {
  $textureKeys += "assets/minecraft/textures/particle/effect_$i.png"
  $textureKeys += "assets/minecraft/textures/particle/glitter_$i.png"
}
for ($i = 0; $i -lt 8; $i++) {
  $textureKeys += "assets/minecraft/textures/particle/generic_$i.png"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($Jar)
try {
  $names = @{}
  foreach ($entry in $zip.Entries) { $names[$entry.FullName] = $entry }
  foreach ($key in $textureKeys) {
    if (-not $names.ContainsKey($key)) { throw "missing texture entry: $key" }
    $entry = $names[$key]
    $rel = $key -replace '^assets/minecraft/textures/', ''
    $dst = Join-Path $OutRoot ("textures\" + $rel)
    New-Item -ItemType Directory -Force (Split-Path -Parent $dst) | Out-Null
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dst, $true)
    $entries += [pscustomobject]@{ kind = "texture"; key = $key; file = "textures/$rel"; bytes = (Get-Item $dst).Length }
  }
} finally {
  $zip.Dispose()
}

$manifest = [pscustomobject]@{
  source = "Minecraft Java 1.20.1-Fabric local install"
  index = $indexPath
  jar = $Jar
  extractedAt = (Get-Date).ToString("o")
  entries = $entries
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $OutRoot "ASSETS.json") -Encoding UTF8
Write-Output ("extracted {0} files to {1}" -f $entries.Count, $OutRoot)
