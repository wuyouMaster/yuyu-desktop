import type { ElectronApplication } from '@playwright/test'
import { ZipArchive } from 'archiver'
import { createHash } from 'node:crypto'
import type { ReportTemplateCatalog } from '../../../src/shared/report-template-market'

const REPORT_TEMPLATE_CATALOG_URL = 'https://raw.githubusercontent.com/fixture-owner/fixture-templates/main/catalog/v1/index.json'

interface FixtureResponse {
  body: string
  type: string
}

/** Real ZIPs and a pinned synthetic catalog; only the HTTP response boundary is replaced. */
export async function templateMarketResponses(): Promise<Record<string, FixtureResponse>> {
  const commit = 'a'.repeat(40)
  const responses: Record<string, FixtureResponse> = {}
  const templates: ReportTemplateCatalog['templates'] = []
  for (const platform of ['mobile', 'desktop'] as const) {
    const id = `community.github.fixture.market-${platform}`
    const width = platform === 'desktop' ? 1100 : 430
    const manifest = {
      protocolVersion: '1.0',
      kind: 'daily-report',
      id,
      name: `fixture market ${platform}`,
      author: { name: 'fixture' },
      templateVersion: '1.0.0',
      interfaceVersion: '1',
      entry: 'template.html',
      capture: { width, maxWidth: width, maxHeight: 20000 },
      license: { spdx: 'MIT' },
      platform
    }
    const archive = new ZipArchive({ zlib: { level: 6 } })
    const chunks: Buffer[] = []
    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    const ended = new Promise<void>((resolve, reject) => {
      archive.once('end', resolve)
      archive.once('error', reject)
    })
    const date = new Date('2026-09-07T00:00:00Z')
    archive.append(JSON.stringify(manifest), { name: 'manifest.json', date })
    archive.append(
      `<!doctype html><html><head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 24px; width: ${width}px; font: 18px/1.5 sans-serif;
          background: ${platform === 'desktop' ? '#eff4ff' : '#ffffff'}; }
      </style></head><body><h1>{{REPORT_TITLE}}</h1><p>{{HERO_SUMMARY}}</p>
      <footer>fixture-${platform}</footer></body></html>`,
      { name: 'template.html', date }
    )
    await Promise.all([ended, archive.finalize()])
    const bytes = Buffer.concat(chunks)
    const download = `https://raw.githubusercontent.com/fixture-owner/fixture-templates/${commit}/packages/${id}/1.0.0.zip`
    responses[download] = { body: bytes.toString('base64'), type: 'application/zip' }
    templates.push({
      id,
      version: '1.0.0',
      interfaceVersion: '1',
      name: manifest.name,
      description: 'Synthetic template market fixture',
      author: 'fixture',
      platform,
      tags: ['fixture'],
      license: 'MIT',
      minAppVersion: null,
      download,
      preview: `https://raw.githubusercontent.com/fixture-owner/fixture-templates/${commit}/previews/${id}.png`,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      status: 'published'
    })
  }
  const catalog: ReportTemplateCatalog = {
    schemaVersion: '1',
    source: { repository: 'fixture-owner/fixture-templates', commit },
    status: 'published',
    templates
  }
  responses[REPORT_TEMPLATE_CATALOG_URL] = {
    body: Buffer.from(JSON.stringify(catalog)).toString('base64'),
    type: 'application/json'
  }
  return responses
}

export async function installTemplateMarketResponses(
  app: ElectronApplication,
  responses: Record<string, FixtureResponse>
) {
  return app.evaluateHandle((_, bodies) => {
    const state = { requests: [] as string[], tamperNextPackage: false }
    globalThis.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      state.requests.push(url)
      const response = bodies[url]
      if (!response) throw new Error(`Unexpected fixture network request: ${url}`)
      let bytes = Buffer.from(response.body, 'base64')
      if (state.tamperNextPackage && response.type === 'application/zip') {
        state.tamperNextPackage = false
        bytes = Buffer.concat([bytes, Buffer.from('synthetic tampering')])
      }
      return new Response(new Uint8Array(bytes), {
        headers: { 'content-type': response.type, 'content-length': String(bytes.length) }
      })
    }
    return state
  }, responses)
}
