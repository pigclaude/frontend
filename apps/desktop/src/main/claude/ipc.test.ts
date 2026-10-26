// 负责验证 Claude IPC 对授权和更新请求的 proxyId 解析：更新时缺省保持不变，null 和空字符串解绑。

import { describe, expect, it } from "vitest"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { ClaudeAccountError } from "./errors"
import { readAuthorizeInput, readUpdateInput } from "./ipc"

const fingerprint: ClaudeFingerprintView = {
  seed: "123456",
  brand: "Chrome",
  platform: "macos",
  lang: "en-US",
  timezone: "America/Los_Angeles",
  canvasNoise: true,
  clientRectsNoise: true,
}

function expectInvalidInput(run: () => unknown): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ClaudeAccountError)
    expect(error).toMatchObject({ code: "INVALID_INPUT" })
    return
  }
  throw new Error("expected INVALID_INPUT")
}

describe("readAuthorizeInput", () => {
  it.each([
    [null, null],
    ["", null],
    ["p1", "p1"],
  ] as const)("parses proxyId %j as %j", (proxyId, expected) => {
    const parsed = readAuthorizeInput({ displayName: "工作账号", proxyId, fingerprint })
    expect(parsed.proxyId).toBe(expected)
  })

  it("rejects a missing proxyId", () => {
    expectInvalidInput(() => readAuthorizeInput({ displayName: "工作账号", fingerprint }))
  })

  it.each([
    ["number", 42],
    ["object", {}],
    ["array", []],
  ] as const)("rejects a %s proxyId", (_label, proxyId) => {
    expectInvalidInput(() => readAuthorizeInput({ displayName: "工作账号", proxyId, fingerprint }))
  })
})

describe("readUpdateInput", () => {
  it("omits proxyId when it is undefined", () => {
    expect(readUpdateInput({ accountId: "acc-1" })).not.toHaveProperty("proxyId")
    expect(readUpdateInput({ accountId: "acc-1", proxyId: undefined })).not.toHaveProperty(
      "proxyId",
    )
  })

  it.each([
    [null, null],
    ["", null],
    ["p1", "p1"],
  ] as const)("parses proxyId %j as %j", (proxyId, expected) => {
    const parsed = readUpdateInput({ accountId: "acc-1", proxyId })
    expect(parsed.proxyId).toBe(expected)
  })

  it.each([
    ["number", 42],
    ["object", {}],
    ["array", []],
  ] as const)("rejects a %s proxyId", (_label, proxyId) => {
    expectInvalidInput(() => readUpdateInput({ accountId: "acc-1", proxyId }))
  })
})
