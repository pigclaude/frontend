// 校验字体下拉的选项表，以及「只列本机已安装的」过滤规则。
import { describe, expect, it } from "vitest"
import { codeFontOptions, installedFontOptions, uiFontOptions } from "./font-options"

describe("字体选项表", () => {
  it("界面字体依次是系统、Inter、思源黑体", () => {
    expect(uiFontOptions.map((option) => option.label)).toEqual(["系统", "Inter", "思源黑体"])
    expect(uiFontOptions.map((option) => option.value)).toEqual(["system", "inter", "source-han"])
  })

  it("代码字体依次是系统、JetBrains Mono、Fira Code、Menlo", () => {
    expect(codeFontOptions.map((option) => option.value)).toEqual([
      "system",
      "jetbrains",
      "fira",
      "menlo",
    ])
  })

  it("「系统」不需要检测", () => {
    expect(uiFontOptions[0]?.family).toBeNull()
    expect(codeFontOptions[0]?.family).toBeNull()
  })
})

describe("installedFontOptions", () => {
  it("只保留检测为已安装的字体，系统项总在", () => {
    const installed = new Set(["Menlo"])
    const result = installedFontOptions(codeFontOptions, "system", (family) =>
      installed.has(family),
    )
    expect(result.map((option) => option.value)).toEqual(["system", "menlo"])
  })

  it("当前选中的字体即使检测不到也保留，下拉不会显示空白", () => {
    const result = installedFontOptions(uiFontOptions, "inter", () => false)
    expect(result.map((option) => option.value)).toEqual(["system", "inter"])
  })

  it("每个字体只检测一次，传给检测函数的是字体族名", () => {
    const asked: string[] = []
    installedFontOptions(uiFontOptions, "system", (family) => {
      asked.push(family)
      return true
    })
    expect(asked).toEqual(["Inter", "Source Han Sans SC"])
  })
})
