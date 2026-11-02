const WORKSPACE_KEY = 'yuyu_workspace_entry_preferred'
const PENDING_SOURCE_KEY = 'yuyu_pending_source_setup'
export type SetupApplication = 'wechat' | 'dingtalk' | 'telegram'
export function prefersWorkspace(): boolean {
  try {
    return localStorage.getItem(WORKSPACE_KEY) === '1'
  } catch {
    return false
  }
}
export function rememberWorkspace(application?: string): void {
  localStorage.setItem(WORKSPACE_KEY, '1')
  if (application) localStorage.setItem(PENDING_SOURCE_KEY, application)
}
export function pendingSourceSetup(): SetupApplication | undefined {
  try {
    const value = localStorage.getItem(PENDING_SOURCE_KEY)
    return value === 'wechat' || value === 'dingtalk' || value === 'telegram' ? value : undefined
  } catch {
    return undefined
  }
}
export function clearPendingSourceSetup(): void {
  try {
    localStorage.removeItem(PENDING_SOURCE_KEY)
  } catch {
    /* Optional navigation hint. */
  }
}
