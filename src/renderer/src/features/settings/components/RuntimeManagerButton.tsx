import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription
} from '../../../components/ui'
import { RuntimeManagerSection } from './RuntimeManagerSection'

export function RuntimeManagerButton({
  application,
  label = '管理应用运行时',
  onClose,
  disabled
}: {
  application?: string
  label?: string
  onClose?: () => void
  disabled?: boolean
} = {}): React.ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) onClose?.()
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogTitle>管理应用运行时</DialogTitle>
          <DialogDescription>
            按需安装应用工具。下载不会切换数据源、操作客户端或发送消息。
          </DialogDescription>
          <RuntimeManagerSection application={application} />
        </DialogContent>
      </Dialog>
    </>
  )
}
