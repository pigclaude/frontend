// 用真实排版核对按钮、单行输入等控件的约定高度。

import { expect, type Locator } from "@playwright/test"

/** 测量可见控件的外框，与指定的 CSS 像素高度比较。 */
export async function expectControlHeights(
  expected: number,
  controls: readonly Locator[],
): Promise<void> {
  await Promise.all(
    controls.map(async (control) => {
      await expect(control).toBeVisible()
      await expect
        .poll(() => control.evaluate((node) => node.getBoundingClientRect().height), {
          message: String(control),
        })
        .toBeCloseTo(expected, 0)
    }),
  )
}
