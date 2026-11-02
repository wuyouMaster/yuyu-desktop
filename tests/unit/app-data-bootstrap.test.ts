import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ root: '', setName: vi.fn(), setPath: vi.fn() }))
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => name === 'appData' ? state.root : path.join(state.root, 'home'),
    setName: state.setName,
    setPath: state.setPath
  }
}))

describe('application bootstrap', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    state.setName.mockReset()
    state.setPath.mockReset()
    if (state.root) fs.rmSync(state.root, { recursive: true, force: true })
  })

  it('uses only the YUYU identity and leaves previously named data intact', async () => {
    state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'yuyu-bootstrap-fixture-'))
    const previous = path.join(state.root, 'TraceMemo', 'database-keys', 'fixture.bin')
    fs.mkdirSync(path.dirname(previous), { recursive: true })
    fs.writeFileSync(previous, 'existing encrypted fixture')
    vi.stubEnv('YUYU_USER_DATA', '')
    vi.stubEnv('YUYU_LEGACY_SAFE_STORAGE_HELPER', '1')
    vi.stubEnv('YUYU_LEGACY_SAFE_STORAGE_SOURCE', path.dirname(path.dirname(previous)))

    await import('../../src/main/app-data-bootstrap')

    expect(state.setName).toHaveBeenCalledOnce()
    expect(state.setName).toHaveBeenCalledWith('语屿 YUYU')
    expect(state.setPath).toHaveBeenCalledWith('userData', path.join(state.root, 'YUYU'))
    expect(state.setPath).toHaveBeenCalledWith('sessionData', path.join(state.root, 'YUYU'))
    expect(fs.readFileSync(previous, 'utf8')).toBe('existing encrypted fixture')
    expect(fs.existsSync(path.join(state.root, 'YUYU', 'database-keys'))).toBe(false)
  })
})
