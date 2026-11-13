// 负责账号授权向导的布局验收：浏览器配置这一步的进度段数、单选圆点、选项文字对齐，以及选中后可继续。

import { expect, test } from "@playwright/test"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

for (const theme of ["light", "dark"] as const) {
  for (const glass of [0, 1] as const) {
    test(`authorize profile step ${theme} glass=${glass}`, async ({ page }) => {
      await page.goto(`/?screen=authorize&theme=${theme}&glass=${glass}`)
      await page.getByRole("button", { name: "下一步", exact: true }).click()
      await expect(page.getByRole("heading", { name: "选择浏览器配置", exact: true })).toBeVisible()

      // 进度段数跟随实际步骤，不留空段。
      const steps = page.locator(".progress-bars i")
      await expect(steps).toHaveCount(5)
      const widths = await steps.evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().width),
      )
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1)

      // 列表选项的圆点保持 14px，名称和说明左对齐、分行显示。
      const choice = page.locator("button.choice").first()
      const dot = choice.locator(".radio-dot")
      expect((await dot.boundingBox())?.width ?? 0).toBeCloseTo(14, 0)
      const lines = await choice.locator(".grow > *").evaluateAll((items) =>
        items.map((item) => ({
          left: item.getBoundingClientRect().left,
          top: item.getBoundingClientRect().top,
          align: getComputedStyle(item).textAlign,
        })),
      )
      expect(lines.length).toBeGreaterThanOrEqual(3)
      for (const line of lines) {
        expect(Math.abs(line.left - (lines[0]?.left ?? 0))).toBeLessThan(1)
        expect(line.align).not.toBe("center")
      }
      for (let index = 1; index < lines.length; index++) {
        expect(lines[index]?.top ?? 0).toBeGreaterThan(lines[index - 1]?.top ?? 0)
      }

      // 选中配置后才能继续。
      const next = page.getByRole("button", { name: "使用此配置", exact: true })
      await expect(next).toBeDisabled()
      await choice.click()
      await expect(next).toBeEnabled()

      await page.evaluate(() => document.fonts.ready)
      await expect(page).toHaveScreenshot(`authorize-profile-${theme}-${glass}.png`, options)
    })
  }
}

// 授权原生窗最小 640px，这里的 420px 额外覆盖 renderer 在极窄视口的可达性。
for (const theme of ["light", "dark"] as const) {
  test(`authorize compact controls at maximum size ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 720 })
    await page.addInitScript(() => {
      localStorage.setItem("pigclaude-appearance", JSON.stringify({ version: 1, uiSize: 18 }))
    })
    await page.goto(`/?screen=authorize&theme=${theme}`)
    await page.getByRole("button", { name: "下一步", exact: true }).click()
    await page.getByRole("heading", { name: "选择浏览器配置", exact: true }).waitFor()
    await page.locator("button.choice").first().click()
    for (const name of ["取消", "使用此配置"]) {
      const button = page.getByRole("button", { name, exact: true })
      await expect(button).toBeEnabled()
      await expect(button).toBeInViewport()
    }
    const width = await page.evaluate(() => ({
      inner: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      scale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale"),
    }))
    expect(width).toEqual({ inner: 420, scroll: 420, scale: String(18 / 13) })
    await page.evaluate(() => document.fonts.ready)
    await expect(page).toHaveScreenshot(`authorize-compact-${theme}.png`, options)
    await page.getByRole("button", { name: "使用此配置", exact: true }).click()
    await expect(page.getByRole("heading", { name: "检测本次授权环境", exact: true })).toBeVisible()
    const check = page.getByRole("button", { name: "检测环境并准备授权", exact: true })
    await expect(check).toBeInViewport()
    await expect(page).toHaveScreenshot(`authorize-environment-compact-${theme}.png`, options)
    await check.click()
    await expect(
      page.getByRole("heading", { name: "查看本机自检报告并继续授权", exact: true }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "重新自检", exact: true })).toBeInViewport()
    await expect(page).toHaveScreenshot(`authorize-waiting-compact-${theme}.png`, options)
    await expect(page.getByRole("heading", { name: "已加入号池", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "回到账号", exact: true })).toBeInViewport()
    await expect(page).toHaveScreenshot(`authorize-completed-compact-${theme}.png`, options)
  })
}
