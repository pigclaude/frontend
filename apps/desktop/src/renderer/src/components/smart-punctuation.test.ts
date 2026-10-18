// 测试智能标点的输入规则开关：开启时执行替换，关闭时 handler 返回 null 保持原样。
import { InputRule } from "@tiptap/react"
import { describe, expect, it, vi } from "vitest"
import { createSmartPunctuation, gateInputRules, insideOpenBacktick } from "./smart-punctuation"

function makeRule(handler: () => void | null) {
  return new InputRule({ find: /--$/, handler, undoable: false })
}

function fakeProps(textBefore: string) {
  const resolved = { parent: { textBetween: () => textBefore }, parentOffset: textBefore.length }
  return {
    state: { doc: { resolve: () => resolved } },
    range: { from: textBefore.length, to: textBefore.length },
  } as never
}

describe("insideOpenBacktick", () => {
  it("奇数个反引号视为未闭合", () => {
    expect(insideOpenBacktick("run `npm")).toBe(true)
    expect(insideOpenBacktick("run `npm` and")).toBe(false)
    expect(insideOpenBacktick("")).toBe(false)
  })
})

describe("gateInputRules", () => {
  it("开关打开时委托给原 handler", () => {
    const inner = vi.fn(() => undefined)
    let on = true
    const [rule] = gateInputRules([makeRule(inner)], () => on)
    expect(rule?.handler(fakeProps("abc"))).toBeUndefined()
    expect(inner).toHaveBeenCalledTimes(1)
    on = false
    expect(rule?.handler(fakeProps("abc"))).toBeNull()
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it("未闭合反引号之后不替换", () => {
    const inner = vi.fn(() => undefined)
    const [rule] = gateInputRules([makeRule(inner)], () => true)
    expect(rule?.handler(fakeProps("run `npm --"))).toBeNull()
    expect(inner).not.toHaveBeenCalled()
  })

  it("保留匹配条件和 undoable", () => {
    const original = makeRule(() => undefined)
    const [rule] = gateInputRules([original], () => true)
    expect(rule?.find).toBe(original.find)
    expect(rule?.undoable).toBe(false)
  })
})

describe("createSmartPunctuation", () => {
  it("每次返回名为 typography 的扩展", () => {
    expect(createSmartPunctuation(() => true).name).toBe("typography")
  })
})
