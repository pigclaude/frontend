// 负责验证语言与时区的 shadcn 搜索组合框：中文别名、代码检索、键盘选择、清空搜索和自定义入口。

// @vitest-environment jsdom
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { defaultFingerprintForm } from "../models/fingerprint-form"
import { installCommandDom } from "../test-support/command-dom"
import { FingerprintForm } from "./fingerprint-form"

let root: Root
let container: HTMLDivElement
let restoreDom: () => void
let latest: ClaudeFingerprintView
const onChange = vi.fn()

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  restoreDom = installCommandDom()
  latest = defaultFingerprintForm()
  onChange.mockClear()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  restoreDom()
  vi.unstubAllGlobals()
})

function Harness() {
  const [value, setValue] = useState(defaultFingerprintForm)
  return createElement(FingerprintForm, {
    value,
    idPrefix: "search",
    onChange: (next: ClaudeFingerprintView) => {
      latest = next
      onChange(next)
      setValue(next)
    },
  })
}

async function render() {
  await act(async () => root.render(createElement(Harness)))
}

function query<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  expect(element, selector).not.toBeNull()
  return element as T
}

async function click(selector: string) {
  await act(async () => query(selector).click())
}

async function type(selector: string, value: string) {
  const input = query<HTMLInputElement>(selector)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function options(): string[] {
  return [...document.querySelectorAll('[role="option"]')].map((item) => item.textContent ?? "")
}

describe("fingerprint searchable choices", () => {
  it("finds a language by its Chinese alias without changing the draft until selected", async () => {
    await render()
    await click("#search-lang")
    await type('input[aria-label="搜索浏览器语言"]', "韩语")
    expect(options()).toEqual(["한국어（ko-KR）"])
    expect(onChange).not.toHaveBeenCalled()
    await click('[role="option"]')
    expect(latest.lang).toBe("ko-KR")
    expect(query("#search-lang").textContent).toBe("한국어（ko-KR）")
    expect(document.querySelector("[cmdk-root]")).toBeNull()
  })

  it("finds a timezone by Chinese name or a case-insensitive IANA code and selects by Enter", async () => {
    await render()
    for (const term of ["上海", "SHANGHAI", "asia/shanghai"]) {
      await click("#search-timezone")
      await type('input[aria-label="搜索时区"]', term)
      expect(options()).toEqual(["上海（Asia/Shanghai）"])
      await act(async () => {
        query('input[aria-label="搜索时区"]').dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        )
      })
      expect(latest.timezone).toBe("Asia/Shanghai")
    }
  })

  it("clears the previous search on reopen and searches preferred languages by code", async () => {
    await render()
    await click("#search-acceptLang")
    await type('input[aria-label="搜索首选语言列表"]', "ko-KR")
    expect(options()).toEqual(["한국어（ko-KR）优先"])
    await click('[role="option"]')
    expect(latest.acceptLang).toBe("ko-KR,ko")
    await click("#search-acceptLang")
    expect(query<HTMLInputElement>('input[aria-label="搜索首选语言列表"]').value).toBe("")
    expect(options()).toContain("跟随浏览器语言")
    expect(options().length).toBeGreaterThan(1)
  })

  it("keeps the custom entry available when there are no results and preserves the original value", async () => {
    await render()
    await click("#search-timezone")
    await type('input[aria-label="搜索时区"]', "no-such-time-zone-zzzz")
    expect(options()).toEqual([])
    expect(query("[cmdk-empty]").textContent).toBe("未找到匹配项")
    expect(latest.timezone).toBe("")
    await click(".combobox-footer button")
    await type("#search-timezone-custom", "Europe/Madrid")
    expect(latest.timezone).toBe("Europe/Madrid")
    await click("#search-group-device")
    await click("#search-group-identity")
    expect(query<HTMLInputElement>("#search-timezone-custom").value).toBe("Europe/Madrid")
  })
})
