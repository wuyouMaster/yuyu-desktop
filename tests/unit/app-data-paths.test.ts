import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  chooseUserDataRoot,
  CURRENT_USER_DATA_NAME,
  getUserDataRoots,
  YUYU_RUNTIME_NAME
} from '../../src/main/app-data-paths'

describe('YUYU app data root', () => {
  it('uses the YUYU application data directory', () => {
    const appData = path.join(path.sep, 'fixture', 'Application Support')
    const roots = getUserDataRoots(appData)

    expect(CURRENT_USER_DATA_NAME).toBe('YUYU')
    expect(YUYU_RUNTIME_NAME).toBe('语屿 YUYU')
    expect(roots).toEqual({ current: path.join(appData, 'YUYU') })
    expect(chooseUserDataRoot(roots)).toBe(roots.current)
  })

  it('supports an isolated YUYU userData directory for tests and development', () => {
    const current = path.join(path.sep, 'fixture', 'YUYU')
    const isolated = path.join(path.sep, 'fixture', 'isolated-user-data')

    expect(chooseUserDataRoot({ current, isolated })).toBe(path.resolve(isolated))
  })
})
