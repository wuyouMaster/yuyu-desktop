import { managedResourcePath } from '../runtime-paths'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const MAX_BUFFER = 16 * 1024 * 1024

export interface DingtalkStoreAccount {
  accountKey: string
  accountHash: string
}

export type DingtalkStoreRow = string[]

export interface DingtalkStoreOptions {
  root?: string
  preferences?: string
  helperPath?: string
  timeoutMs?: number
}

function decode(value: string): string {
  if (!value) return ''
  return Buffer.from(value, 'base64').toString('utf8')
}

function helperCandidates(): string[] { return [managedResourcePath('dingtalk/dtstore')!] }

function parseOutput(stdout: string): { meta?: string[]; rows: DingtalkStoreRow[] } {
  const rows: DingtalkStoreRow[] = []
  let meta: string[] | undefined
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue
    const fields = line.split('\t')
    if (fields[0] === 'error') throw new Error(fields[1] || 'dingtalk_store_error')
    if (fields[0] === 'meta') meta = fields.slice(1)
    else if (fields[0] === 'row') rows.push(fields.slice(1))
  }
  return { meta, rows }
}

export class DingtalkStore {
  private readonly options: Required<Pick<DingtalkStoreOptions, 'root' | 'preferences' | 'timeoutMs'>> &
    Pick<DingtalkStoreOptions, 'helperPath'>

  constructor(options: DingtalkStoreOptions = {}) {
    this.options = {
      root: options.root ?? join(homedir(), 'Library/Application Support/DingTalkMac'),
      preferences: options.preferences ?? join(homedir(), 'Library/Preferences/com.alibaba.DingTalkMac.plist'),
      timeoutMs: options.timeoutMs ?? 20_000,
      helperPath: options.helperPath
    }
  }

  async account(): Promise<DingtalkStoreAccount> {
    const output = await this.run('account')
    if (!output.meta || output.meta.length < 2 || !output.meta[0] || !output.meta[1]) {
      throw new Error('dingtalk_account_metadata_invalid')
    }
    return { accountKey: output.meta[0], accountHash: output.meta[1] }
  }

  async conversations(limit = 200): Promise<DingtalkStoreRow[]> {
    return (await this.run('conversations', ['--limit', String(limit)])).rows
  }

  async members(cid: string | undefined, limit = 500): Promise<DingtalkStoreRow[]> {
    const args = ['--limit', String(limit)]
    if (cid) args.push('--cid', cid)
    return (await this.run('members', args)).rows
  }

  async messages(
    cid: string,
    options: { beforeTime?: number; beforeId?: string; limit?: number } = {}
  ): Promise<DingtalkStoreRow[]> {
    const args = ['--cid', cid, '--limit', String(options.limit ?? 128)]
    if (options.beforeTime !== undefined && options.beforeId) {
      args.push('--before-time', String(options.beforeTime), '--before-id', options.beforeId)
    }
    return (await this.run('messages', args)).rows
  }

  decode(value: string): string {
    return decode(value)
  }

  private async run(operation: string, args: string[] = []): Promise<{ meta?: string[]; rows: DingtalkStoreRow[] }> {
    const helper = this.options.helperPath ?? helperCandidates().find((candidate) => existsSync(candidate))
    if (!helper) throw new Error('dingtalk_store_helper_missing')
    const commandArgs = [operation, '--root', this.options.root, '--preferences', this.options.preferences, ...args]
    try {
      const { stdout } = await execute(helper, commandArgs, {
        timeout: this.options.timeoutMs,
        maxBuffer: MAX_BUFFER,
        windowsHide: true
      })
      return parseOutput(stdout)
    } catch (error) {
      const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : ''
      if (code) throw new Error(code)
      throw new Error('dingtalk_store_unavailable')
    }
  }
}
