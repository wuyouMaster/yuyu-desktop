import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.root } }))
vi.mock('os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, default: { ...original, homedir: () => state.root } }
})

beforeEach(() => {
  state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-api-settings-'))
  vi.stubEnv('WE_SETTINGS_DIR', state.root)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(state.root, { recursive: true, force: true })
})

describe('local API startup preference', () => {
  it('defaults to disabled when no settings file exists', async () => {
    const { loadSettings } = await import('../../src/main/services/settings-store')
    expect(loadSettings().apiEnabled).toBe(false)
    expect(fs.existsSync(path.join(state.root, 'settings.json'))).toBe(false)
  })

  it.each([
    { name: 'missing field', raw: {}, expected: true },
    { name: 'enabled', raw: { apiEnabled: true }, expected: true },
    { name: 'disabled', raw: { apiEnabled: false }, expected: false }
  ])('preserves an existing profile with $name', async ({ raw, expected }) => {
    const file = path.join(state.root, 'settings.json')
    const original = JSON.stringify({ ...raw, dbRoot: 'synthetic-account' })
    fs.writeFileSync(file, original)
    const { loadSettings } = await import('../../src/main/services/settings-store')
    expect(loadSettings().apiEnabled).toBe(expected)
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
  })

  it.each([true, false])('keeps a manually selected %s state on reload', async (enabled) => {
    const { updateSettings } = await import('../../src/main/services/settings-store')
    updateSettings({ apiEnabled: enabled })
    vi.resetModules()
    const { loadSettings } = await import('../../src/main/services/settings-store')
    expect(loadSettings().apiEnabled).toBe(enabled)
  })
})
