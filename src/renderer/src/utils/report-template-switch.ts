import type {
  GroupReportExportRequest,
  GroupReportExportResult
} from '../../../shared/group-report'
import type {
  GeneratedReportRecord,
  UpdateGeneratedReportTemplateRequest,
  UpdateGeneratedReportTemplateResult
} from '../../../shared/report-history'
import {
  decodeExternalReportTemplateId,
  type ReportTemplateRequestId,
  type ReportTemplateSelectionId
} from '../../../shared/report-templates'

interface ReportTemplateSwitchApi {
  exportGroupReport: (request: GroupReportExportRequest) => Promise<GroupReportExportResult>
  updateGeneratedReportTemplate: (
    request: UpdateGeneratedReportTemplateRequest
  ) => Promise<UpdateGeneratedReportTemplateResult>
}

export async function switchGeneratedReportTemplate(
  report: GeneratedReportRecord,
  templateId: ReportTemplateSelectionId,
  api: ReportTemplateSwitchApi
): Promise<UpdateGeneratedReportTemplateResult> {
  const externalRef = decodeExternalReportTemplateId(templateId)
  const exportSelection = externalRef
    ? { templateRef: externalRef }
    : { templateId: templateId as ReportTemplateRequestId }
  let exported: GroupReportExportResult
  if (report.reportSnapshot && report.reportMetadata) {
    exported = await api.exportGroupReport({
      report: report.reportSnapshot,
      metadata: report.reportMetadata,
      ...exportSelection
    })
  } else {
    return { success: false, error: '日报缺少结构化数据，无法切换模板' }
  }
  if (!exported.success || !exported.imageDataUrl || !exported.htmlPath || !exported.pngPath) {
    return { success: false, error: exported.error || '新模板导出失败' }
  }

  return api.updateGeneratedReportTemplate({
    reportId: report.id,
    templateId,
    ...(externalRef ? { templateRef: externalRef } : {}),
    generatedImage: exported.imageDataUrl,
    htmlPath: exported.htmlPath,
    pngPath: exported.pngPath
  })
}
