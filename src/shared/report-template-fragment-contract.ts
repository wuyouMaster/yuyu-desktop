export const REPORT_TEMPLATE_FRAGMENT_CONTRACT_VERSION = '1'

// 外部模板可以通过变量调整主题，但不允许生产 fragment 失去基本几何约束。
export const REPORT_TEMPLATE_FRAGMENT_CONTRACT_CSS = `
:root {
  --yuyu-avatar-message-size: 34px;
  --yuyu-avatar-participant-size: 22px;
  --yuyu-avatar-ranking-size: 26px;
  --yuyu-avatar-hero-size: 40px;
  --yuyu-avatar-radius: 50%;
  --yuyu-message-gap: 8px;
  --yuyu-participant-gap: 4px;
}

html,
body {
  min-width: 0 !important;
  max-width: 100%;
}

.yuyu-fragment { min-width: 0 !important; max-width: 100%; }

.yuyu-fragment,
.yuyu-fragment * {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.yuyu-message {
  display: flex !important;
  align-items: flex-start !important;
  gap: var(--yuyu-message-gap, 8px);
  min-width: 0 !important;
  max-width: 100%;
}

.yuyu-message__body {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  max-width: 100%;
}

.yuyu-message__meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 6px;
  min-width: 0;
  max-width: 100%;
}

.yuyu-participant {
  display: inline-flex !important;
  align-items: center !important;
  gap: var(--yuyu-participant-gap, 4px);
  min-width: 0 !important;
  max-width: 100%;
}

.yuyu-avatar {
  box-sizing: border-box !important;
  aspect-ratio: 1 / 1 !important;
  object-fit: cover !important;
  flex-shrink: 0 !important;
  border-radius: var(--yuyu-avatar-radius, 50%);
}

img.yuyu-avatar.yuyu-avatar--message {
  width: clamp(28px, var(--yuyu-avatar-message-size, 34px), 44px) !important;
  height: clamp(28px, var(--yuyu-avatar-message-size, 34px), 44px) !important;
  min-width: clamp(28px, var(--yuyu-avatar-message-size, 34px), 44px) !important;
  max-width: clamp(28px, var(--yuyu-avatar-message-size, 34px), 44px) !important;
  min-height: clamp(28px, var(--yuyu-avatar-message-size, 34px), 44px) !important;
  max-height: clamp(28px, var(--yuyu-avatar-message-size, 34px), 44px) !important;
  flex-basis: clamp(28px, var(--yuyu-avatar-message-size, 34px), 44px) !important;
}

img.yuyu-avatar.yuyu-avatar--participant {
  width: clamp(18px, var(--yuyu-avatar-participant-size, 22px), 28px) !important;
  height: clamp(18px, var(--yuyu-avatar-participant-size, 22px), 28px) !important;
  min-width: clamp(18px, var(--yuyu-avatar-participant-size, 22px), 28px) !important;
  max-width: clamp(18px, var(--yuyu-avatar-participant-size, 22px), 28px) !important;
  min-height: clamp(18px, var(--yuyu-avatar-participant-size, 22px), 28px) !important;
  max-height: clamp(18px, var(--yuyu-avatar-participant-size, 22px), 28px) !important;
  flex-basis: clamp(18px, var(--yuyu-avatar-participant-size, 22px), 28px) !important;
}

img.yuyu-avatar.yuyu-avatar--ranking {
  width: clamp(20px, var(--yuyu-avatar-ranking-size, 26px), 34px) !important;
  height: clamp(20px, var(--yuyu-avatar-ranking-size, 26px), 34px) !important;
  min-width: clamp(20px, var(--yuyu-avatar-ranking-size, 26px), 34px) !important;
  max-width: clamp(20px, var(--yuyu-avatar-ranking-size, 26px), 34px) !important;
  min-height: clamp(20px, var(--yuyu-avatar-ranking-size, 26px), 34px) !important;
  max-height: clamp(20px, var(--yuyu-avatar-ranking-size, 26px), 34px) !important;
  flex-basis: clamp(20px, var(--yuyu-avatar-ranking-size, 26px), 34px) !important;
}

img.yuyu-avatar.yuyu-avatar--hero {
  width: clamp(28px, var(--yuyu-avatar-hero-size, 40px), 56px) !important;
  height: clamp(28px, var(--yuyu-avatar-hero-size, 40px), 56px) !important;
  min-width: clamp(28px, var(--yuyu-avatar-hero-size, 40px), 56px) !important;
  max-width: clamp(28px, var(--yuyu-avatar-hero-size, 40px), 56px) !important;
  min-height: clamp(28px, var(--yuyu-avatar-hero-size, 40px), 56px) !important;
  max-height: clamp(28px, var(--yuyu-avatar-hero-size, 40px), 56px) !important;
}

.yuyu-message__author,
.yuyu-message__time,
.yuyu-message__text,
.yuyu-participant__name {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

@media (max-width: 680px) {
  /* 只折叠承载 production fragment 的主内容网格，避免桌面模板把正文压成多列窄缝。 */
  main > :has(.yuyu-fragment) {
    grid-template-columns: minmax(0, 1fr) !important;
    min-width: 0 !important;
  }
}
`

export const injectReportTemplateFragmentContract = (html: string): string => {
  const style = `<style id="yuyu-production-fragment-contract" data-version="${REPORT_TEMPLATE_FRAGMENT_CONTRACT_VERSION}">${REPORT_TEMPLATE_FRAGMENT_CONTRACT_CSS}</style>`
  if (/<\/head\s*>/i.test(html)) return html.replace(/<\/head\s*>/i, `${style}</head>`)
  return `${style}${html}`
}
