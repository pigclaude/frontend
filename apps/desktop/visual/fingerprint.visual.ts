// 负责指纹设置的浏览器验收：弹层下拉、分组草稿、错误定位、固定操作区、浅深色与玻璃外观及窄窗口布局。

import { expect, test, type Locator, type Page } from "@playwright/test"

async function openEditor(page: Page, theme: string, glass = "0"): Promise<void> {
  await page.goto(`/?screen=accounts&theme=${theme}&glass=${glass}`)
  await page.getByRole("button", { name: /工作 Max/ }).click()
  await page.getByRole("button", { name: "编辑", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
}

async function openWizard(page: Page, theme: string, glass: string): Promise<void> {
  await page.goto(`/?screen=authorize&theme=${theme}&glass=${glass}`)
  await page.getByRole("button", { name: "下一步", exact: true }).click()
  await page.getByRole("button", { name: "使用系统网络", exact: true }).click()
  await expect(page.getByRole("heading", { name: "设置浏览器指纹", exact: true })).toBeVisible()
}

/** 弹层和字段滚动区都没有横向溢出，并且每行右侧的控件都留在所在行里。 */
async function fitsHorizontally(root: Locator): Promise<boolean> {
  return root.evaluate((element) => {
    const scrollers = [element, ...element.querySelectorAll(".fp-content")]
    if (scrollers.some((box) => box.scrollWidth > box.clientWidth)) return false
    return [...element.querySelectorAll(".fp-row")].every((row) => {
      const edge = row.getBoundingClientRect()
      return [...row.querySelectorAll(".trail, .trail *")].every((child) => {
        const box = child.getBoundingClientRect()
        return box.left >= edge.left - 0.5 && box.right <= edge.right + 0.5
      })
    })
  })
}

/** 判断 root 里的分组卡片和图标方块是否都使用 token 这个背景变量。 */
async function surfaceUses(page: Page, root: string, token: string): Promise<boolean> {
  return page.locator(root).evaluate((element, name) => {
    const probe = document.createElement("div")
    probe.style.background = `var(${name})`
    element.append(probe)
    const expected = getComputedStyle(probe).backgroundColor
    probe.remove()
    const targets = [...element.querySelectorAll(".fp-section .group, .fp-environment-icon")]
    return (
      targets.length > 1 &&
      targets.every((target) => getComputedStyle(target).backgroundColor === expected)
    )
  }, token)
}

test("fingerprint glass surfaces: only the light glass dialog uses --field", async ({ page }) => {
  for (const [theme, glass, token] of [
    ["light", "1", "--field"],
    ["light", "0", "--panel"],
    ["dark", "1", "--panel"],
  ] as const) {
    await openEditor(page, theme, glass)
    expect(await surfaceUses(page, ".fingerprint-dialog", token), `${theme} ${glass}`).toBe(true)
  }
  await openWizard(page, "light", "1")
  expect(await surfaceUses(page, ".fingerprint-window", "--panel")).toBe(true)
})

for (const theme of ["light", "dark"]) {
  test(`fingerprint search ${theme}: filters names and codes, supports keyboard and keeps custom values`, async ({
    page,
  }, testInfo) => {
    await openEditor(page, theme)
    const dialog = page.locator(".fingerprint-dialog")
    await dialog.getByRole("combobox", { name: "浏览器语言", exact: true }).click()
    await page.getByRole("combobox", { name: "搜索浏览器语言", exact: true }).fill("韩语")
    await expect(page.getByRole("option")).toHaveCount(1)
    await page.getByRole("option", { name: "한국어（ko-KR）", exact: true }).click()
    await expect(dialog.getByRole("combobox", { name: "浏览器语言", exact: true })).toContainText(
      "ko-KR",
    )

    await dialog.getByRole("combobox", { name: "时区", exact: true }).click()
    const search = page.getByRole("combobox", { name: "搜索时区", exact: true })
    await expect(search).toBeFocused()
    await search.fill("SHANGHAI")
    await expect(page.getByRole("option")).toHaveCount(1)
    await expect(
      page.getByRole("option", { name: "上海（Asia/Shanghai）", exact: true }),
    ).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("fingerprint-search.png") })
    await search.press("Enter")
    await expect(dialog.getByRole("combobox", { name: "时区", exact: true })).toContainText(
      "Asia/Shanghai",
    )
    await expect(page.locator(".combobox-popover")).toBeHidden()

    await dialog.getByRole("combobox", { name: "时区", exact: true }).press("ArrowDown")
    await expect(search).toHaveValue("")
    await search.fill("unmatched-zzzz")
    await expect(page.getByText("未找到匹配项", { exact: true })).toBeVisible()
    await page
      .locator(".combobox-footer")
      .getByRole("button", { name: "自定义…", exact: true })
      .click()
    await expect(dialog.getByLabel("自定义时区", { exact: true })).toBeFocused()
    await dialog.getByLabel("自定义时区", { exact: true }).fill("Europe/Madrid")
    await dialog.getByRole("combobox", { name: "时区", exact: true }).click()
    await search.fill("东京")
    await search.press("Escape")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel("自定义时区", { exact: true })).toHaveValue("Europe/Madrid")
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText("Europe/Madrid", { exact: true })).toBeVisible()
  })

  test(`fingerprint editor ${theme}: selects a preset, changes groups and locates errors`, async ({
    page,
  }, testInfo) => {
    await openEditor(page, theme)
    const dialog = page.getByRole("dialog")
    await expect(dialog).not.toContainText("AntBrowser")
    const seed = await dialog.getByLabel("自定义指纹种子", { exact: true }).inputValue()

    await dialog.getByRole("combobox", { name: "浏览器品牌", exact: true }).click()
    await page.getByRole("option", { name: "Edge", exact: true }).click()
    await expect(dialog.locator(".fp-environment-name")).toHaveText("Edge · macOS")

    for (const [label, option] of [
      ["浏览器版本", "147"],
      ["系统版本", "15.2.0"],
      ["浏览器语言", "日本語（ja-JP）"],
      ["时区", "东京（Asia/Tokyo）"],
      ["首选语言列表", "日本語（ja-JP）优先"],
    ]) {
      await dialog.getByRole("combobox", { name: label, exact: true }).click()
      await page.getByRole("option", { name: option, exact: true }).click()
    }

    await dialog.getByRole("combobox", { name: "快捷预设", exact: true }).click()
    await page.getByRole("option", { name: /^macOS · Chrome 日本/ }).click()
    await expect(dialog.getByRole("combobox", { name: "时区", exact: true })).toContainText(
      "Asia/Tokyo",
    )
    await expect(dialog.getByLabel("自定义指纹种子", { exact: true })).toHaveValue(seed)
    await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeInViewport()
    await dialog.screenshot({ path: testInfo.outputPath("fingerprint-identity.png") })

    await dialog.locator("#fingerprint-dialog-group-compat").click()
    await dialog.locator("#fingerprint-dialog-canvasNoise-0").click()
    await dialog.getByRole("switch", { name: "停用 字体 伪装", exact: true }).check()
    await expect(dialog.locator("#fingerprint-dialog-canvasNoise-0")).toHaveAttribute(
      "data-state",
      "on",
    )
    await expect(dialog.getByRole("combobox", { name: "快捷预设", exact: true })).toHaveText(
      "自定义配置",
    )
    await dialog.screenshot({ path: testInfo.outputPath("fingerprint-privacy.png") })

    await dialog.locator("#fingerprint-dialog-group-device").click()
    await dialog.getByRole("combobox", { name: "CPU 核心数", exact: true }).click()
    await page.getByRole("option", { name: "自定义…", exact: true }).click()
    await expect(dialog.getByLabel("自定义CPU 核心数", { exact: true })).toBeFocused()
    await dialog.getByLabel("自定义CPU 核心数", { exact: true }).fill("0")
    await dialog.locator("#fingerprint-dialog-group-advanced").click()
    await dialog.getByLabel("自定义启动参数", { exact: true }).fill("--disable-gpu")
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await expect(
      dialog.getByText("CPU 核心数必须是 1 到 128 的整数", { exact: true }),
    ).toBeVisible()
    await expect(dialog.getByLabel("自定义CPU 核心数", { exact: true })).toBeFocused()
    await dialog.getByLabel("自定义CPU 核心数", { exact: true }).fill("8")
    await dialog.locator("#fingerprint-dialog-group-advanced").click()
    await expect(dialog.getByLabel("自定义启动参数", { exact: true })).toHaveValue("--disable-gpu")
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText("--disable-gpu", { exact: true })).toBeVisible()
  })

  test(`fingerprint narrow editor ${theme}: keeps navigation and save visible`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 420, height: 720 })
    await openEditor(page, theme)
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeInViewport()
    await expect(dialog.locator("#fingerprint-dialog-group-advanced")).toBeInViewport()
    expect(await fitsHorizontally(dialog)).toBe(true)
    await dialog.getByRole("combobox", { name: "时区", exact: true }).click()
    await page.getByRole("combobox", { name: "搜索时区", exact: true }).fill("New_York")
    await expect(page.locator(".combobox-popover")).toBeInViewport({ ratio: 1 })
    await page.getByRole("option", { name: "纽约（America/New_York）", exact: true }).click()
    await dialog.locator("#fingerprint-dialog-group-device").click()
    await dialog.getByRole("combobox", { name: "窗口大小", exact: true }).click()
    await page.getByRole("option", { name: "自定义", exact: true }).click()
    await dialog.getByLabel("自定义窗口大小", { exact: true }).fill("1440,900")
    expect(await fitsHorizontally(dialog)).toBe(true)
    await dialog.screenshot({ path: testInfo.outputPath("fingerprint-narrow.png") })
    await dialog.getByRole("button", { name: "取消", exact: true }).click()
    await expect(dialog).toBeHidden()
  })

  test(`fingerprint authorization ${theme}: fits the wizard and keeps the draft`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/?screen=authorize&theme=${theme}`)
    await page.getByRole("button", { name: "下一步", exact: true }).click()
    await page.getByRole("button", { name: "使用系统网络", exact: true }).click()
    await expect(page.getByRole("heading", { name: "设置浏览器指纹", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "保存并继续", exact: true })).toBeInViewport({
      ratio: 1,
    })
    await page.getByRole("combobox", { name: "指纹种子", exact: true }).click()
    await page.getByRole("option", { name: "自定义…", exact: true }).click()
    await page.getByLabel("自定义指纹种子", { exact: true }).fill("654321")
    await page.locator("#authorize-group-compat").click()
    await page.locator("#authorize-canvasNoise-1").click()
    await page.locator("#authorize-group-identity").click()
    await expect(page.getByLabel("自定义指纹种子", { exact: true })).toHaveValue("654321")
    await page.getByLabel("自定义指纹种子", { exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByLabel("自定义指纹种子", { exact: true })).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: testInfo.outputPath("fingerprint-authorization.png") })
    await page.getByRole("button", { name: "保存并继续", exact: true }).click()
    await expect(page.getByRole("button", { name: "开始授权", exact: true })).toBeVisible()
  })

  test(`fingerprint layout ${theme}: long values fit, height stays fixed, arrows switch groups`, async ({
    page,
  }) => {
    await openEditor(page, theme)
    const dialog = page.locator(".fingerprint-dialog")
    const fits = () => fitsHorizontally(dialog)
    const height = async () => (await dialog.boundingBox())?.height ?? 0

    const timezone = dialog.getByRole("combobox", { name: "时区", exact: true })
    await expect(timezone).toContainText("America/Los_Angeles")
    const value = timezone.locator(".select-trigger-value")
    expect(await value.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)

    for (const [label, text] of [
      ["时区", "America/Argentina/ComodRivadavia"],
      ["首选语言列表", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,ja;q=0.6"],
    ]) {
      await dialog.getByRole("combobox", { name: label, exact: true }).click()
      await page.getByRole("combobox", { name: `搜索${label}`, exact: true }).fill("unmatched-zzzz")
      await page
        .locator(".combobox-footer")
        .getByRole("button", { name: "自定义…", exact: true })
        .click()
      await dialog.getByLabel(`自定义${label}`, { exact: true }).fill(text)
    }
    expect(await fits()).toBe(true)

    const start = await height()
    await dialog.locator("#fingerprint-dialog-group-identity").focus()
    // Radix 单选组在方向键按住期间才选中新项，按键需要有真实的按下时长。
    await page.keyboard.press("ArrowRight", { delay: 50 })
    await expect(dialog.locator("#fingerprint-dialog-group-device")).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(Math.abs((await height()) - start)).toBeLessThan(1)
    await dialog.getByRole("combobox", { name: "窗口大小", exact: true }).click()
    await page.getByRole("option", { name: "自定义", exact: true }).click()
    expect(Math.abs((await height()) - start)).toBeLessThan(1)
    expect(await fits()).toBe(true)
    for (const group of ["compat", "advanced"]) {
      await dialog.locator(`#fingerprint-dialog-group-${group}`).click()
      expect(Math.abs((await height()) - start)).toBeLessThan(1)
    }
    expect(await fits()).toBe(true)
  })

  test(`fingerprint narrow errors ${theme}: error counts and tabs stay visible`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 420, height: 720 })
    await openEditor(page, theme)
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("自定义指纹种子", { exact: true }).fill("abc")
    await dialog.locator("#fingerprint-dialog-group-device").click()
    await dialog.getByRole("combobox", { name: "CPU 核心数", exact: true }).click()
    await page.getByRole("option", { name: "自定义…", exact: true }).click()
    await dialog.getByLabel("自定义CPU 核心数", { exact: true }).fill("0")
    await dialog.getByRole("button", { name: "保存", exact: true }).click()

    const counts = dialog.locator(".fp-error-count")
    await expect(counts).toHaveCount(2)
    for (const count of await counts.all()) await expect(count).toBeInViewport({ ratio: 1 })
    await expect(dialog.locator("#fingerprint-dialog-group-advanced")).toBeInViewport()
    expect(await fitsHorizontally(dialog)).toBe(true)
    await dialog.screenshot({ path: testInfo.outputPath("fingerprint-narrow-errors.png") })
  })

  for (const glass of ["0", "1"]) {
    test(`fingerprint screenshots ${theme} glass=${glass}`, async ({ page }, testInfo) => {
      for (const [width, height] of [
        [1200, 800],
        [420, 720],
      ]) {
        await page.setViewportSize({ width, height })
        await openEditor(page, theme, glass)
        const dialog = page.locator(".fingerprint-dialog")
        for (const group of ["identity", "device", "compat", "advanced"]) {
          await dialog.locator(`#fingerprint-dialog-group-${group}`).click()
          await dialog.screenshot({ path: testInfo.outputPath(`dialog-${width}-${group}.png`) })
        }
        await openWizard(page, theme, glass)
        await page.screenshot({ path: testInfo.outputPath(`wizard-${width}.png`) })
      }
    })
  }
}
