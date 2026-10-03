import { execFileSync, spawn } from 'node:child_process'
import { extname, join } from 'node:path'

/** What host mode needs from the machine, injectable so that tests start no process and touch no clipboard. */
export type HostIo = {
  /** Serves each page on a local URL (see host-carry.ts) and returns the URLs, in order. */
  carry(pages: { target: string; fragment: string }[]): Promise<string[]>
  clipboard: { read(): string; write(text: string): void }
}

export const systemIo: HostIo = { carry, clipboard: { read: readClipboard, write: writeClipboard } }

// The sources run as TypeScript, an installed package as compiled JavaScript.
const script = (name: string) => join(import.meta.dirname, name + extname(import.meta.filename))
/** A 200 MiB download expands to about 267 MiB as base64, plus its handoff header. */
const CLIPBOARD_BYTES = 300 * 1024 * 1024

async function carry(pages: { target: string; fragment: string }[]): Promise<string[]> {
  const child = spawn(process.execPath, [script('host-carry')], {
    detached: true,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  })
  child.stdin.end(JSON.stringify(pages))
  const port = await new Promise<number>((resolve, reject) => {
    child.stdout.once('data', (data) => resolve(Number(String(data).trim())))
    child.once('error', reject)
    child.once('exit', () => reject(new Error('Ritoko could not start its local page for the browser')))
  })
  child.stdout.destroy()
  child.unref()
  return pages.map((_, i) => `http://127.0.0.1:${port}/${i}`)
}

function readClipboard(): string {
  if (process.platform === 'win32')
    return execFileSync(
      'powershell',
      ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw'],
      { encoding: 'utf8', maxBuffer: CLIPBOARD_BYTES, windowsHide: true },
    ).replace(/\r?\n$/, '')
  if (process.platform === 'darwin')
    return execFileSync('pbpaste', { encoding: 'utf8', maxBuffer: CLIPBOARD_BYTES })
  return execFileSync('xclip', ['-selection', 'clipboard', '-o'], {
    encoding: 'utf8',
    maxBuffer: CLIPBOARD_BYTES,
  })
}

function writeClipboard(text: string): void {
  if (process.platform === 'win32')
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        '[Console]::InputEncoding=[Text.Encoding]::UTF8; $t=[Console]::In.ReadToEnd(); if ($t) { Set-Clipboard -Value $t } else { Set-Clipboard -Value $null }',
      ],
      { input: text, windowsHide: true },
    )
  else if (process.platform === 'darwin') execFileSync('pbcopy', { input: text })
  else execFileSync('xclip', ['-selection', 'clipboard'], { input: text })
}
