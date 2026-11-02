import { it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExecutionActivity } from '../../src/renderer/src/components/chat/ExecutionActivity'
import type { AgentActivity } from '../../src/shared/agent-runtime'

it('preserves nested expand/collapse state across live updates', () => {
  const items: AgentActivity[] = [
    { id: 'a', kind: 'agent', label: '检索子任务', state: 'running', startedAt: 100 },
    { id: 't', parentId: 'a', kind: 'tool', label: '搜索关键词', state: 'running', startedAt: 110 }
  ]
  const { rerender } = render(<ExecutionActivity items={items} />)
  const parent = screen.getByText('检索子任务').closest('details')!
  fireEvent.click(parent.querySelector('summary')!)
  fireEvent(parent, new Event('toggle'))
  expect(parent.open).toBe(true)
  const child = screen.getByText('搜索关键词').closest('details')!
  fireEvent.click(child.querySelector('summary')!)
  fireEvent(child, new Event('toggle'))
  rerender(<ExecutionActivity items={items.map((item) => ({ ...item, state: 'completed', endedAt: 1200, summary: '返回合成结果' }))} />)
  expect(parent.open).toBe(true)
  expect(child.open).toBe(true)
  expect(screen.getAllByText('返回合成结果')).toHaveLength(2)
  fireEvent.click(parent.querySelector('summary')!)
  fireEvent(parent, new Event('toggle'))
  expect(parent.open).toBe(false)
})
