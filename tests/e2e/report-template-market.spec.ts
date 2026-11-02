import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installTemplateMarketResponses, templateMarketResponses } from './support/template-market'

test('REPORT-TEMPLATE-MARKET-E2E-01 reads, installs, restores, renders, and switches catalog templates', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'yuyu-template-market-user-'))
  const outputDir = mkdtempSync(join(tmpdir(), 'yuyu-template-market-output-'))
  // This isolated test entry uses a synthetic catalog; production has no source.
  const responses = await templateMarketResponses()
  let network: Awaited<ReturnType<typeof installTemplateMarketResponses>> | undefined
  const launch = async (): ReturnType<typeof electron.launch> => {
    const launched = await electron.launch({
      args: [resolve('out/main/reportTemplateTest.js')],
      env: {
        ...process.env,
        YUYU_TEMPLATE_TEST_USER_DATA: userData,
        YUYU_TEMPLATE_TEST_MARKET_FIXTURE: '1',
        YUYU_REPORT_OUTPUT_DIR: outputDir
      }
    })
    try {
      const window = await launched.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      if (responses) network = await installTemplateMarketResponses(launched, responses)
      return launched
    } catch (error) {
      await launched.close()
      throw error
    }
  }

  const report = {
    overview: '虚构远端模板日报概览',
    hero: {
      headline: '今日群聊重点',
      summary: '虚构的结构化日报内容',
      keyTakeaway: '保留结构化快照并切换版式',
      pendingNote: '',
      statusLine: ''
    },
    topics: [
      {
        title: '模板市场联调',
        timeRange: '09:00-10:00',
        heat: '高' as const,
        participants: ['小明'],
        summary: '验证安装、重启恢复和导出',
        keywords: ['模板', '日报'],
        messages: []
      }
    ],
    resources: [],
    importantMessages: [],
    quotes: [],
    qa: [],
    todos: [],
    unresolved: [],
    storylines: [],
    reversals: [],
    participantChains: [],
    analytics: {
      topicHeat: [{ topic: '模板市场联调', score: 1 }],
      activeTimeline: '09:00-10:00',
      topSpeakers: [{ name: '小明', count: 1 }],
      voiceLeaderboard: []
    },
    keywords: ['模板', '日报'],
    media: { gallery: [], voiceHighlights: [], funBadges: [] }
  }
  const metadata = {
    groupName: '虚构市场验收群',
    reportDate: '2026-09-07',
    dateRange: '今日',
    messageCount: 1,
    activeUsers: 1,
    timeSpan: '09:00-10:00',
    generatedAt: '2026-09-07 10:00',
    recordNote: 'fixture',
    footerNote: 'market fixture',
    heroParticipants: ['小明'],
    avatars: {}
  }

  let app: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    app = await launch()
    let page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    const catalogResult = await page.evaluate(() => window.api.listReportTemplateCatalog())
    expect(catalogResult.success, catalogResult.error).toBe(true)
    const catalog = catalogResult.catalog
    expect(catalog?.status).toBe('published')
    const sourceCommit = catalog?.source?.commit
    expect(sourceCommit).toMatch(/^[a-f0-9]{40}$/)
    const entries = catalog!.templates
    // The pinned fixture must satisfy the same integrity checks used by a configured source.
    expect(entries.length).toBeGreaterThanOrEqual(2)
    for (const entry of entries) {
      expect(entry.interfaceVersion).toBe('1')
      expect(entry.status).toBe('published')
      expect(entry.download).toContain(`/fixture-owner/fixture-templates/${sourceCommit}/`)
      expect(entry.preview).toContain(`/fixture-owner/fixture-templates/${sourceCommit}/`)
    }

    if (network) {
      await network.evaluate((state) => {
        state.tamperNextPackage = true
      })
      const rejected = await page.evaluate(
        ({ id, version }) => window.api.installReportTemplateFromCatalog(id, version),
        entries[0]
      )
      expect(rejected.success).toBe(false)
      expect(rejected.code).toBe('download_integrity_failed')
    }

    const exportsById = new Map<
      string,
      { htmlPath: string; pngPath: string; imageDataUrl: string; version: string }
    >()
    for (const entry of entries) {
      const installed = await page.evaluate(
        async ({ id, version }) => window.api.installReportTemplateFromCatalog(id, version),
        { id: entry.id, version: entry.version }
      )
      expect(installed.success, installed.error).toBe(true)
      expect(installed.catalogEntry?.sha256).toBe(entry.sha256)
      expect(installed.template?.id).toBe(entry.id)
      expect(installed.template?.version).toBe(entry.version)

      const exported = await page.evaluate(
        async ({ id, version, reportValue, metadataValue }) =>
          window.api.exportGroupReport({
            templateRef: { id, version },
            report: reportValue,
            metadata: metadataValue
          }),
        { id: entry.id, version: entry.version, reportValue: report, metadataValue: metadata }
      )
      expect(exported.success, exported.error).toBe(true)
      expect(exported.htmlPath).toBeTruthy()
      expect(exported.pngPath).toBeTruthy()
      expect(readFileSync(exported.htmlPath!, 'utf8')).toContain('虚构的结构化日报内容')
      const png = readFileSync(exported.pngPath!)
      expect(png.length).toBeGreaterThan(1000)
      const renderedWidth = png.readUInt32BE(16)
      expect(renderedWidth).toBeGreaterThanOrEqual(entry.platform === 'desktop' ? 1000 : 400)
      expect(png.readUInt32BE(20)).toBeGreaterThan(100)
      exportsById.set(entry.id, {
        htmlPath: exported.htmlPath!,
        pngPath: exported.pngPath!,
        imageDataUrl: exported.imageDataUrl!,
        version: entry.version
      })
    }

    if (network) {
      const requested = await network.evaluate((state) => state.requests)
      for (const entry of entries) expect(requested).toContain(entry.download)
      await network.dispose()
      network = undefined
    }

    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const restored = await page.evaluate(() => window.api.listReportTemplates())
    for (const entry of entries) {
      expect(
        restored.some((template) => template.id === entry.id && template.version === entry.version)
      ).toBe(true)
    }

    const [firstTemplate, secondTemplate] = entries
    const firstExport = exportsById.get(firstTemplate.id)!
    const saved = await page.evaluate(
      async ({ firstExportValue, reportValue, metadataValue, templateId }) =>
        window.api.saveGeneratedReport({
          contactId: 'fixture-market-group',
          contactName: metadataValue.groupName,
          source: 'manual',
          dateRange: metadataValue.dateRange,
          messageCount: metadataValue.messageCount,
          generatedAt: '2026-09-07T10:00:00.000Z',
          reportDate: metadataValue.reportDate,
          generatedImage: firstExportValue.imageDataUrl,
          htmlPath: firstExportValue.htmlPath,
          pngPath: firstExportValue.pngPath,
          reportSnapshot: reportValue,
          reportMetadata: metadataValue,
          templateId
        }),
      {
        firstExportValue: firstExport,
        reportValue: report,
        metadataValue: metadata,
        templateId: `external:${firstTemplate.id}@${firstTemplate.version}` as const
      }
    )
    expect(saved.success, saved.error).toBe(true)
    const reportId = saved.record!.id

    const switchedExport = await page.evaluate(
      async ({ id, version, reportValue, metadataValue }) =>
        window.api.exportGroupReport({
          templateRef: { id, version },
          report: reportValue,
          metadata: metadataValue
        }),
      {
        id: secondTemplate.id,
        version: secondTemplate.version,
        reportValue: report,
        metadataValue: metadata
      }
    )
    expect(switchedExport.success, switchedExport.error).toBe(true)
    const switched = await page.evaluate(
      async ({ reportIdValue, id, version, exported }) =>
        window.api.updateGeneratedReportTemplate({
          reportId: reportIdValue,
          templateId: `external:${id}@${version}`,
          templateRef: { id, version },
          generatedImage: exported.imageDataUrl,
          htmlPath: exported.htmlPath,
          pngPath: exported.pngPath
        }),
      {
        reportIdValue: reportId,
        id: secondTemplate.id,
        version: secondTemplate.version,
        exported: {
          imageDataUrl: switchedExport.imageDataUrl!,
          htmlPath: switchedExport.htmlPath!,
          pngPath: switchedExport.pngPath!
        }
      }
    )
    expect(switched.success, switched.error).toBe(true)
    expect(switched.record?.id).toBe(reportId)
    expect(switched.record?.templateId).toBe(
      `external:${secondTemplate.id}@${secondTemplate.version}`
    )
    expect(switched.record?.reportSnapshot).toEqual(report)
    expect(readFileSync(switched.record!.htmlPath!, 'utf8')).toContain('虚构的结构化日报内容')

    const history = await page.evaluate(() => window.api.listGeneratedReports())
    expect(history.success).toBe(true)
    expect(history.reports?.find((record) => record.id === reportId)?.templateId).toBe(
      `external:${secondTemplate.id}@${secondTemplate.version}`
    )

    const removed = await page.evaluate(
      async ({ id, version }) => window.api.uninstallReportTemplate(id, version),
      { id: secondTemplate.id, version: secondTemplate.version }
    )
    expect(removed.success, removed.error).toBe(true)
    const afterUninstall = await page.evaluate(
      async ({ id, version, reportValue, metadataValue }) =>
        window.api.exportGroupReport({
          templateRef: { id, version },
          report: reportValue,
          metadata: metadataValue
        }),
      {
        id: secondTemplate.id,
        version: secondTemplate.version,
        reportValue: report,
        metadataValue: metadata
      }
    )
    expect(afterUninstall.success).toBe(false)
    expect(afterUninstall.error).toContain('模板不存在')

    const legacyHtml = join(outputDir, 'legacy-without-structured-data.html')
    writeFileSync(legacyHtml, '<!doctype html><html><body><h1>旧日报</h1></body></html>')
    const legacy = await page.evaluate(
      async ({ htmlPath, pngPath, imageDataUrl }) =>
        window.api.saveGeneratedReport({
          contactId: 'fixture-legacy-group',
          contactName: '虚构旧日报',
          dateRange: '今日',
          messageCount: 1,
          generatedAt: '2026-09-07T11:00:00.000Z',
          htmlPath,
          pngPath,
          generatedImage: imageDataUrl
        }),
      { htmlPath: legacyHtml, pngPath: firstExport.pngPath, imageDataUrl: firstExport.imageDataUrl }
    )
    expect(legacy.success).toBe(true)
    const legacySwitch = await page.evaluate(
      async ({ reportIdValue, id, version, imageDataUrl, htmlPath }) =>
        window.api.updateGeneratedReportTemplate({
          reportId: reportIdValue,
          templateId: `external:${id}@${version}`,
          templateRef: { id, version },
          generatedImage: imageDataUrl,
          htmlPath,
          pngPath: htmlPath
        }),
      {
        reportIdValue: legacy.record!.id,
        id: firstTemplate.id,
        version: firstTemplate.version,
        imageDataUrl: firstExport.imageDataUrl,
        htmlPath: legacyHtml
      }
    )
    expect(legacySwitch.success).toBe(false)
    expect(legacySwitch.error).toContain('未保存结构化数据')
  } finally {
    await network?.dispose()
    if (app) await app.close()
    rmSync(outputDir, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})
