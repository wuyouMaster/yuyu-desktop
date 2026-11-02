import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const file = (name: string) => readFileSync(resolve(process.cwd(), name), 'utf8')

describe('public application release configuration', () => {
  it('keeps local directory builds offline and directs explicit release builds to the public app', () => {
    expect(file('electron-builder.yml')).toMatch(/^publish:\s*null\s*$/m)
    expect(file('scripts/build-unpacked.mjs')).toContain("'never'")
    const release = file('electron-builder.release.yml')
    expect(release).toMatch(/^extends:\s*\.\/electron-builder\.yml\s*$/m)
    expect(release).toMatch(/^\s+provider:\s*github\s*$/m)
    expect(release).toMatch(/^\s+owner:\s*wuyouMaster\s*$/m)
    expect(release).toMatch(/^\s+repo:\s*yuyu-desktop\s*$/m)
    expect(release).toMatch(/^\s+releaseType:\s*draft\s*$/m)
    expect(release).toMatch(/target:\s*\[dmg,\s*zip\]/)
    expect(release).toMatch(/target:\s*\[nsis\]/)
    expect(release).toContain('artifactName: yuyu-desktop-${version}-${arch}.${ext}')
    expect(release).toContain('artifactName: yuyu-desktop-${version}-${arch}-setup.${ext}')
    expect(release).not.toContain('wechat_decrypt')
    expect(release).not.toContain('TraceMemo')
  })
})
