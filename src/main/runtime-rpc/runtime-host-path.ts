/** Paths are part of each runtime's signed-off package layout, not renderer input. */
export function runtimeHostPath(application: string, target: string): string | undefined {
  const base =
    application === 'wechat'
      ? 'wechat-storage-host'
      : application === 'telegram'
        ? 'telegram/telegram-storage-host'
        : undefined
  return base && base + (target.startsWith('win32-') ? '.exe' : '')
}
