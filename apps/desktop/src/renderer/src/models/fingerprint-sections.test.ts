// 负责验证指纹表单的小组划分和环境摘要小标签：小组覆盖每个字段一次，空值有兜底文字。

import { describe, expect, it } from "vitest"
import {
  defaultFingerprintForm,
  fingerprintEnvironmentChips,
  fingerprintGroups,
} from "./fingerprint-form"

describe("fingerprint sections", () => {
  it("splits every group into titled sections that cover each field exactly once", () => {
    expect(
      fingerprintGroups.map((group) => group.sections.map((section) => section.title)),
    ).toEqual([
      ["浏览器", "系统", "语言与时区", "种子"],
      ["窗口", "硬件", "网络"],
      ["噪声", "停用特征伪装"],
      ["启动参数"],
    ])
    expect(fingerprintGroups[0]?.sections.map((section) => section.fields)).toEqual([
      ["brand", "brandVersion"],
      ["platform", "platformVersion"],
      ["lang", "acceptLang", "timezone"],
      ["seed"],
    ])
    for (const group of fingerprintGroups) {
      const flat = group.sections.flatMap((section) => section.fields)
      expect([...flat].sort()).toEqual([...group.fields].sort())
      expect(new Set(flat).size).toBe(flat.length)
    }
    expect(fingerprintGroups[2]?.sections[1]?.description).toBe(
      "打开开关后，对应特征使用原始值，适合排查页面兼容问题。",
    )
    // 带说明的小组只有一个字段，说明文字就是该字段的提示，表单用它的 hint id 渲染。
    for (const section of fingerprintGroups.flatMap((group) => group.sections)) {
      if (section.description !== undefined) expect(section.fields).toHaveLength(1)
    }
  })
})

describe("fingerprint environment chips", () => {
  it("falls back for an empty locale and seed", () => {
    expect(fingerprintEnvironmentChips(defaultFingerprintForm())).toEqual([
      { text: "跟随系统语言", mono: false },
      { text: "系统时区", mono: false },
      { text: "种子自动", mono: false },
    ])
  })

  it("shows the configured locale and a monospace seed", () => {
    const value = {
      ...defaultFingerprintForm(),
      lang: "en-US",
      timezone: "America/Los_Angeles",
      seed: " 937461 ",
    }
    expect(fingerprintEnvironmentChips(value)).toEqual([
      { text: "en-US", mono: false },
      { text: "America/Los_Angeles", mono: false },
      { text: "种子 937461", mono: true },
    ])
  })
})
