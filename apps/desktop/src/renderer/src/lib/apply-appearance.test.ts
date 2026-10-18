// 测试 applyAppearance 先移除过期项再写入新项的行为，用假根对象，不依赖 DOM。
import { describe, expect, it } from "vitest"
import { applyAppearance, type AppearanceRoot } from "./apply-appearance"

function fakeRoot(): {
  root: AppearanceRoot
  vars: Map<string, string>
  attrs: Map<string, string>
} {
  const vars = new Map<string, string>()
  const attrs = new Map<string, string>()
  const root: AppearanceRoot = {
    style: {
      setProperty: (name, value) => void vars.set(name, value ?? ""),
      removeProperty: (name) => {
        const old = vars.get(name) ?? ""
        vars.delete(name)
        return old
      },
    },
    setAttribute: (name, value) => void attrs.set(name, value),
    removeAttribute: (name) => void attrs.delete(name),
  }
  return { root, vars, attrs }
}

describe("applyAppearance", () => {
  it("没有上一次结果时只写入", () => {
    const { root, vars, attrs } = fakeRoot()
    applyAppearance(root, { vars: { "--a": "1" }, attrs: { "data-x": "y" } }, null)
    expect(Object.fromEntries(vars)).toEqual({ "--a": "1" })
    expect(Object.fromEntries(attrs)).toEqual({ "data-x": "y" })
  })

  it("移除上一次有而这次没有的变量和属性，保留并更新其余", () => {
    const { root, vars, attrs } = fakeRoot()
    const first = { vars: { "--a": "1", "--b": "2" }, attrs: { "data-x": "y", "data-z": "1" } }
    applyAppearance(root, first, null)
    root.setAttribute("data-theme", "dark")
    applyAppearance(root, { vars: { "--b": "3" }, attrs: { "data-z": "2" } }, first)
    expect(Object.fromEntries(vars)).toEqual({ "--b": "3" })
    expect(Object.fromEntries(attrs)).toEqual({ "data-z": "2", "data-theme": "dark" })
  })

  it("恢复默认（空输出）时清空上一次写入的全部项", () => {
    const { root, vars, attrs } = fakeRoot()
    const first = { vars: { "--a": "1" }, attrs: { "data-x": "y" } }
    applyAppearance(root, first, null)
    applyAppearance(root, { vars: {}, attrs: {} }, first)
    expect(vars.size).toBe(0)
    expect(attrs.size).toBe(0)
  })
})
