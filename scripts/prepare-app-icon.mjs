import { chromium } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
const svg = await readFile(
  new URL('../src/renderer/src/assets/brand-icon.svg', import.meta.url),
  'utf8'
)
const output = new URL('../build/icon.png', import.meta.url)
await mkdir(new URL('../build/', import.meta.url), { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1
  })
  await page.setContent(
    '<style>html,body{margin:0;background:transparent}svg{width:1024px;height:1024px;display:block}</style>' +
      svg
  )
  await page.screenshot({ path: output.pathname, omitBackground: true })
} finally {
  await browser.close()
}
