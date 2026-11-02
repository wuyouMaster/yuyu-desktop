import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { AgentExecutionView, AgentQuote } from '../../shared/agent-runtime'
import type { AskWechatEvidenceItem } from '../../shared/query-agent'
export interface Artifact {
  id: string
  taskId: string
  summary: string
  evidence: AskWechatEvidenceItem[]
  status: 'completed' | 'partial' | 'failed'
}
export interface RunSnapshot {
  owner: string
  scopeKey: string
  question: string
  view: AgentExecutionView
  artifacts: Artifact[]
  evidence: AskWechatEvidenceItem[]
  quotes: AgentQuote[]
  skillHashes: Record<string, string>
}
export interface StoredSession {
  turns: Array<{ question: string; answer: string }>
  runs: RunSnapshot[]
}
export interface StoreCodec {
  encode(value: string): Buffer
  decode(value: Buffer): string
}
export class RuntimeStore {
  private readonly memory = new Map<string, StoredSession>()
  constructor(
    private readonly directory?: string,
    private readonly codec?: StoreCodec
  ) {}
  private file(key: string): string {
    return path.join(this.directory!, createHash('sha256').update(key).digest('hex') + '.bin')
  }
  load(key: string): StoredSession {
    if (!this.memory.has(key) && this.directory && this.codec && existsSync(this.file(key))) {
      const value = JSON.parse(this.codec.decode(readFileSync(this.file(key)))) as StoredSession
      if (!Array.isArray(value.turns) || !Array.isArray(value.runs))
        throw new Error('会话存档格式无效')
      this.memory.set(key, value)
    }
    return structuredClone(this.memory.get(key) || { turns: [], runs: [] })
  }
  save(key: string, session: StoredSession): void {
    const bounded = { turns: session.turns.slice(-30), runs: session.runs.slice(-8) }
    this.memory.delete(key)
    this.memory.set(key, structuredClone(bounded))
    while (this.memory.size > 30) this.memory.delete(this.memory.keys().next().value!)
    // Never fall back to plaintext when OS encryption is unavailable.
    if (!this.directory || !this.codec) return
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const file = this.file(key),
      tmp = file + '.' + randomUUID() + '.tmp'
    writeFileSync(tmp, this.codec.encode(JSON.stringify(bounded)), { mode: 0o600 })
    renameSync(tmp, file)
  }
  forget(key: string): void {
    this.save(key, { turns: [], runs: [] })
  }
}
