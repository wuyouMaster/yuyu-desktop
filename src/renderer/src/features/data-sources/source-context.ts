import { createContext, useContext } from 'react'

/** UI metadata for an account connection. Provider details stay in source adapters. */
export interface SourceAccountOption {
  id: string
  source: string
  sourceLabel: string
  label: string
  accountHint?: string
  avatar?: string
  /** A discovery action belongs to a source menu but is not an account. */
  discovery?: boolean
  status: 'connected' | 'connecting' | 'available' | 'needs_setup'
}

export interface SourceScope {
  active: SourceAccountOption
  openSwitcher: () => void
}

export const SourceScopeContext = createContext<SourceScope | null>(null)
export const useSourceScope = (): SourceScope | null => useContext(SourceScopeContext)
