import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export class Logger {
  private readonly file: string

  constructor(userDataPath: string) {
    const logDirectory = join(userDataPath, 'logs')
    mkdirSync(logDirectory, { recursive: true })
    this.file = join(logDirectory, 'main.log')
  }

  info(message: string): void {
    this.write('INFO', message)
  }

  warn(message: string): void {
    this.write('WARN', message)
  }

  error(message: string): void {
    this.write('ERROR', message)
  }

  private write(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
    const line = `${new Date().toISOString()} [${level}] ${message}\n`
    try {
      appendFileSync(this.file, line, 'utf8')
    } catch (error: unknown) {
      console.error('[pet] log write failed', error)
    }
    if (level === 'ERROR') console.error(`[pet] ${message}`)
    else if (level === 'WARN') console.warn(`[pet] ${message}`)
    else console.info(`[pet] ${message}`)
  }
}
