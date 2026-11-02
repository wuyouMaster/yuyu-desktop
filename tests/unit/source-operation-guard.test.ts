import { describe, expect, it } from 'vitest'
import { SourceOperationGuard } from '../../src/main/services/source-operation-guard'

describe('source operation guard', () => {
  it('keeps the source stable until every concurrent operation finishes', async () => {
    const guard = new SourceOperationGuard()
    let finish!: () => void
    const pending = guard.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const releaseSecond = guard.beginOperation()
    expect(() => guard.beginChange()).toThrow('任务正在执行')
    finish()
    await pending
    expect(() => guard.beginChange()).toThrow('任务正在执行')
    releaseSecond()
    releaseSecond()
    const releaseChange = guard.beginChange()
    await expect(guard.run(async () => 'wrong-account')).rejects.toThrow('切换数据源')
    releaseChange()
    expect(await guard.run(async () => 'new-account')).toBe('new-account')
  })

  it('releases failed operations and serializes connection changes', async () => {
    const guard = new SourceOperationGuard()
    await expect(
      guard.run(async () => {
        throw new Error('fixture failure')
      })
    ).rejects.toThrow('fixture failure')
    const release = guard.beginChange()
    expect(() => guard.beginChange()).toThrow('切换数据源')
    release()
    release()
    expect(() => guard.beginChange()).not.toThrow()
  })
})
