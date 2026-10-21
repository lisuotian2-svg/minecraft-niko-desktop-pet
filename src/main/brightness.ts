import { execFile } from 'node:child_process'

/**
 * Reads the current internal-display brightness through Windows WMI.
 * Returns null when the device has no brightness sensor (common on desktops).
 * The subprocess is short-lived and cached for 20 s.
 */
export class BrightnessMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private inFlight = false
  private lastValue: number | null = null

  constructor(private readonly onChange: (value: number | null) => void) { }

  getLast(): number | null { return this.lastValue }

  start(): void {
    if (this.timer) return
    this.running = true
    this.poll()
    this.timer = setInterval(() => this.poll(), 20_000)
  }

  stop(): void {
    this.running = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private poll(): void {
    if (!this.running || this.inFlight) return
    this.inFlight = true
    const command = [
      '(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness',
      '-ErrorAction Stop | Select-Object -First 1).CurrentBrightness'
    ].join(' ')
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 5000, encoding: 'utf8' },
      (error, stdout) => {
        this.inFlight = false
        if (!this.running) return
        let value: number | null = null
        if (!error) {
          const parsed = Number(String(stdout).trim())
          if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) value = Math.round(parsed)
        }
        this.lastValue = value
        // Send on every poll: the renderer may have missed the first event after a reload.
        this.onChange(value)
      }
    )
  }
}
