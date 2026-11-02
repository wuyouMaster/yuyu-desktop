import { execFile } from 'node:child_process'
import { chmod } from 'node:fs/promises'
import { win32 } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
let currentSid: Promise<string> | undefined

/** Apply only to a newly created, empty directory owned by this process. */
export async function makePrivateDirectory(path: string): Promise<void> {
  if (process.platform !== 'win32') {
    await chmod(path, 0o700)
    return
  }
  const system32 = win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
  currentSid ??= execute(win32.join(system32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
    timeout: 5000,
    encoding: 'utf8',
    windowsHide: true
  }).then(({ stdout }) => {
    const sid = stdout.match(/\bS-1-(?:\d+-)*\d+\b/)?.[0]
    if (!sid) throw new Error('Unable to resolve the private cache owner')
    return sid
  })
  // New files inherit only the current user's grant. chmod alone does not set a Windows DACL.
  await execute(
    win32.join(system32, 'icacls.exe'),
    [path, '/inheritance:r', '/grant:r', `*${await currentSid}:(OI)(CI)F`, '/q'],
    { timeout: 5000, windowsHide: true }
  )
}
