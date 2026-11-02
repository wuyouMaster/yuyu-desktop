import { expect, test } from '@playwright/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { compile } from 'sass'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { createServer } from 'vite'
import type { ComponentType } from 'react'
let Checkbox: ComponentType<{ checked: boolean; disabled: boolean; 'aria-label': string }>

let Switch: typeof Checkbox

// Use the real styles in renderer import order: jsdom does not resolve the CSS cascade.
let css: string

test.beforeAll(async () => {
  const server = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
    esbuild: { jsx: 'automatic' }
  })
  try {
    Switch = (await server.ssrLoadModule('/src/renderer/src/components/ui/switch.tsx')).Switch
    Checkbox = (await server.ssrLoadModule('/src/renderer/src/components/ui/checkbox.tsx')).Checkbox
  } finally {
    await server.close()
  }
  const utilities = await postcss([tailwindcss()]).process(
    readFileSync('src/renderer/src/styles/tailwind.css', 'utf8'),
    { from: 'src/renderer/src/styles/tailwind.css' }
  )
  css =
    utilities.css +
    compile('src/renderer/src/styles/index.scss', { logger: { warn() {}, debug() {} } }).css
})

for (const theme of ['light', 'dark']) {
  test(`checkbox selection remains visible in ${theme} application theme`, async ({ page }) => {
    const controls = [false, true].flatMap((disabled) =>
      [false, true].map((checked) =>
        createElement(Checkbox, {
          key: `${disabled}-${checked}`,
          checked,
          disabled,
          'aria-label': `${disabled ? 'disabled' : 'enabled'}-${checked}`
        })
      )
    )
    await page.setContent(
      renderToStaticMarkup(
        createElement(
          'div',
          {
            className: `app-shell theme-${theme}`,
            'data-theme': theme
          },
          ...controls,
          createElement(Switch, {
            checked: false,
            disabled: false,
            'aria-label': 'notification-off'
          }),
          createElement(Switch, { checked: true, disabled: false, 'aria-label': 'notification-on' })
        )
      )
    )
    await page.addStyleTag({ content: css })
    const checked = page.getByRole('checkbox', { name: 'enabled-true', exact: true })
    const unchecked = page.getByRole('checkbox', { name: 'enabled-false', exact: true })
    await expect(checked).toBeChecked()
    const colors = await Promise.all(
      [checked, unchecked].map((control) =>
        control.evaluate((element) => getComputedStyle(element).backgroundColor)
      )
    )
    expect(colors[0]).not.toBe(colors[1])
    const on = page.getByRole('switch', { name: 'notification-on' })
    const off = page.getByRole('switch', { name: 'notification-off' })
    await expect(on).toBeChecked()
    await expect(off).not.toBeChecked()
    expect(await on.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(
      await off.evaluate((e) => getComputedStyle(e).backgroundColor)
    )
    await expect(on.locator('span')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 16, 0)')
    await expect(off.locator('span')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
    for (const name of ['enabled-true', 'disabled-true']) {
      const tick = page.getByRole('checkbox', { name, exact: true }).locator('span > span')
      await expect(tick).toBeVisible()
      await expect(tick).toHaveCSS('border-bottom-style', 'solid')
      await expect(tick).toHaveCSS('border-right-style', 'solid')
      await expect(tick).toHaveCSS('border-bottom-width', '2px')
    }
  })
}
