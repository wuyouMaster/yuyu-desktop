import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import type { AgentRole } from '../../shared/agent-runtime'

const ROLES: AgentRole[] = ['main', 'planner', 'retriever', 'analyst', 'verifier']
export interface SkillCatalogEntry {
  id: string
  name: string
  description: string
  roles: AgentRole[]
}
export interface RuntimeSkill extends SkillCatalogEntry {
  hash: string
  body: string
}

/** Intentionally small frontmatter dialect: unique single-line fields, no YAML evaluation. */
function parseSkill(id: string, body: string): RuntimeSkill {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)?.[1]
  if (!header) throw new Error(`Skill ${id} 缺少元信息`)
  const fields = new Map<string, string>()
  for (const line of header.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue
    const pair = /^([a-z-]+):\s*(.+)$/.exec(line)
    if (!pair || fields.has(pair[1])) throw new Error(`Skill ${id} 元信息格式无效`)
    fields.set(pair[1], pair[2].trim())
  }
  const name = fields.get('name'),
    description = fields.get('description')
  if (name !== id || !description || description.length > 600)
    throw new Error(`Skill ${id} 名称或描述无效`)
  const roles =
    fields
      .get('roles')
      ?.split(',')
      .map((v) => v.trim()) || ROLES
  if (!roles.length || roles.some((role) => !ROLES.includes(role as AgentRole)))
    throw new Error(`Skill ${id} 角色无效`)
  return {
    id,
    name,
    description,
    roles: [...new Set(roles)] as AgentRole[],
    body,
    hash: createHash('sha256').update(body).digest('hex')
  }
}
export class SkillRegistry {
  private readonly files = new Map<string, string>()
  constructor(directory: string) {
    const root = realpathSync(directory)
    for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (!entry.isDirectory() || !/^[a-z0-9-]+$/.test(entry.name)) continue
      const file = realpathSync(path.join(root, entry.name, 'SKILL.md'))
      if (!file.startsWith(root + path.sep)) throw new Error('Skill 路径越界')
      this.files.set(entry.name, file)
      this.load(entry.name)
    }
  }
  catalog(role?: AgentRole): SkillCatalogEntry[] {
    return [...this.files.keys()]
      .map((id) => this.load(id))
      .filter((skill) => !role || skill.roles.includes(role))
      .map(({ id, name, description, roles }) => ({ id, name, description, roles }))
  }
  load(id: string, role?: AgentRole): RuntimeSkill {
    const file = this.files.get(id)
    if (!file) throw new Error('未知 Skill')
    if (realpathSync(file) !== file) throw new Error('Skill 路径已变更')
    if (statSync(file).size > 32_000) throw new Error('Skill 文件过大')
    const skill = parseSkill(id, readFileSync(file, 'utf8'))
    if (role && !skill.roles.includes(role)) throw new Error(`Skill ${id} 不适用于 ${role}`)
    return skill
  }
}
