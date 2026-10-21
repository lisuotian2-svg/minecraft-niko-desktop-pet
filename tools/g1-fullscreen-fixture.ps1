param(
  [int]$DurationSeconds = 135,
  [string]$StopFile = "",
  [string]$ClickLog = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = [System.Windows.Forms.Form]::new()
$form.Text = "Niko G1 Fullscreen QA Fixture"
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
$form.ShowInTaskbar = $true
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(25, 31, 49)
$form.Bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$form.KeyPreview = $true
$form.Add_MouseDown({
  if ($ClickLog) {
    [System.IO.File]::AppendAllText($ClickLog,
      "$([DateTime]::UtcNow.ToString('o')) x=$($_.X) y=$($_.Y)$([Environment]::NewLine)")
  }
})
$form.Add_KeyDown({
  if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $form.Close() }
})

$label = [System.Windows.Forms.Label]::new()
$label.Text = "NIKO G1  •  FULLSCREEN QA"
$label.Font = [System.Drawing.Font]::new("Segoe UI", 20)
$label.ForeColor = [System.Drawing.Color]::FromArgb(180, 190, 215)
$label.BackColor = [System.Drawing.Color]::Transparent
$label.AutoSize = $true
$label.Location = [System.Drawing.Point]::new(40, 38)
$form.Controls.Add($label)

$deadline = [DateTime]::UtcNow.AddSeconds($DurationSeconds)
$timer = [System.Windows.Forms.Timer]::new()
$timer.Interval = 250
$timer.Add_Tick({
  if ([DateTime]::UtcNow -ge $deadline -or ($StopFile -and (Test-Path -LiteralPath $StopFile))) {
    $form.Close()
  } elseif (-not $form.ContainsFocus) {
    $form.Activate()
  }
})
$form.Add_Shown({ $form.Activate(); $timer.Start() })
try {
  [System.Windows.Forms.Application]::Run($form)
} finally {
  $timer.Stop()
  $timer.Dispose()
  $form.Dispose()
}
