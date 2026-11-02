/** Keep the single native connection stable for operations that still read it asynchronously. */
export class SourceOperationGuard {
  private operations = 0
  private changing = false

  beginOperation(): () => void {
    if (this.changing) throw new Error('正在切换数据源，请稍后重试')
    this.operations += 1
    let released = false
    return () => {
      if (!released) {
        released = true
        this.operations -= 1
      }
    }
  }

  beginChange(): () => void {
    if (this.changing) throw new Error('正在切换数据源，请稍后重试')
    if (this.operations)
      throw new Error('当前账号有发送、导出或日报任务正在执行，请等待完成后再切换数据源')
    this.changing = true
    let released = false
    return () => {
      if (!released) {
        released = true
        this.changing = false
      }
    }
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const release = this.beginOperation()
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
export const sourceOperationGuard = new SourceOperationGuard()
