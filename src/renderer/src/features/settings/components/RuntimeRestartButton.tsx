import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription
} from '../../../components/ui'
import { rememberWorkspace } from '../../data-sources/workspace-entry'

export function RuntimeRestartButton({
  application
}: {
  application?: string
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        重启并继续配置
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogContent>
          <DialogTitle>重启以启用运行时</DialogTitle>
          <DialogDescription>
            应用将关闭并重新打开，当前任务会停止。请先完成未保存的操作。重启后保留主界面入口；没有已连接数据源时，可继续配置所选应用。
          </DialogDescription>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              稍后
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true)
                setError('')
                void (async () => {
                  try {
                    rememberWorkspace(application)
                    await window.api.restartForRuntime()
                  } catch {
                    setBusy(false)
                    setError('未能重启，请稍后重试或手动退出并重新打开应用。')
                  }
                })()
              }}
            >
              {busy ? '正在重启…' : '确认重启'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
