// 负责用非敏感哨兵验证桌面环境拒绝未知变量，同时保留必要OS和公开端点。
import { test, expect } from "@playwright/test"
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  desktopEnvironment,
  requireProductionDesktopGate,
  validateTask7Gate,
} from "./phase1-production-desktop-support"

test("桌面环境不继承服务端及验收输入哨兵", () => {
  const source = {
    PATH: "/fixture/bin",
    HOME: "/fixture/home",
    PIGCLAUDE_TURNSTILE_SECRET_KEY: "non-sensitive-sentinel",
    PIGCLAUDE_SETTINGS_KEY_FILE: "/fixture/master-key",
    DATABASE_URL: "fixture-database",
    REDIS_URL: "fixture-redis",
    PIGCLAUDE_ACCEPTANCE_ADMIN_PASSWORD: "non-sensitive-sentinel",
    PIGCLAUDE_DESKTOP_INPUT_FILE: "/fixture/private-input",
    UNKNOWN_FUTURE_SECRET: "non-sensitive-sentinel",
    NODE_OPTIONS: "fixture-options",
    ELECTRON_RUN_AS_NODE: "1",
  }
  const actual = desktopEnvironment(
    source,
    "/fixture/profile",
    "https://api.pigclaude.com",
    "https://pigclaude.com",
  )
  expect(Object.keys(actual).sort()).toEqual([
    "HOME",
    "PATH",
    "PIGCLAUDE_AUTH_ORIGIN",
    "PIGCLAUDE_RUST_BASE_URL",
    "PIGCLAUDE_USER_DATA",
  ])
  expect(actual.HOME).toBe(source.HOME)
  expect(actual.PIGCLAUDE_RUST_BASE_URL).toBe("https://api.pigclaude.com")
  expect(actual.PIGCLAUDE_AUTH_ORIGIN).toBe("https://pigclaude.com")
})

test("缺少真实Task7放行时拒绝", () => {
  const previous = process.env["PIGCLAUDE_TASK7_GATE"]
  delete process.env["PIGCLAUDE_TASK7_GATE"]
  try {
    expect(() => requireProductionDesktopGate()).toThrow("Task7真实放行")
  } finally {
    if (previous === undefined) delete process.env["PIGCLAUDE_TASK7_GATE"]
    else process.env["PIGCLAUDE_TASK7_GATE"] = previous
  }
})

test("生产桌面拒绝旧root API映射和伪造Task7完整来源", () => {
  expect(() =>
    desktopEnvironment({}, "/fixture/profile", "https://pigclaude.com", "https://pigclaude.com"),
  ).toThrow("生产桌面端点")
})

test("Task7真实gate必须包含四来源和同一镜像源码", () => {
  const source = "a".repeat(40)
  const origins = [
    "https://pigclaude.com",
    "https://www.pigclaude.com",
    "https://admin.pigclaude.com",
    "https://api.pigclaude.com",
  ]
  expect(validateTask7Gate({ status: "PASS", source, origins }, source)).toBe(true)
  expect(validateTask7Gate({ status: "PASS", source, origins: origins.slice(0, 2) }, source)).toBe(
    false,
  )
  expect(validateTask7Gate({ status: "PASS", source, origins }, "b".repeat(40))).toBe(false)
  expect(validateTask7Gate({ status: "PASS", source, origins, token: "private" }, source)).toBe(
    false,
  )
})

test("Task7 gate普通文件完整来源通过，缺失或符号链接拒绝", () => {
  const keys = [
    "PIGCLAUDE_TASK7_GATE",
    "PIGCLAUDE_PUBLIC_SOURCE_SHA",
    "PIGCLAUDE_TASK7_GATE_FILE",
  ] as const
  const previous = keys.map((key) => process.env[key])
  const directory = mkdtempSync(join(tmpdir(), "pigclaude-d1-gate-"))
  const file = join(directory, "gate.json")
  try {
    process.env[keys[0]] = "PASS"
    process.env[keys[1]] = "a".repeat(40)
    process.env[keys[2]] = file
    expect(() => requireProductionDesktopGate()).toThrow("gate文件无效")
    writeFileSync(
      file,
      JSON.stringify({
        status: "PASS",
        source: "a".repeat(40),
        origins: [
          "https://pigclaude.com",
          "https://www.pigclaude.com",
          "https://admin.pigclaude.com",
          "https://api.pigclaude.com",
        ],
      }),
      { mode: 0o600 },
    )
    expect(() => requireProductionDesktopGate()).not.toThrow()
    chmodSync(file, 0o644)
    expect(() => requireProductionDesktopGate()).toThrow("gate文件无效")
    chmodSync(file, 0o600)
    const link = join(directory, "link.json")
    symlinkSync(file, link)
    process.env[keys[2]] = link
    expect(() => requireProductionDesktopGate()).toThrow("gate文件无效")
  } finally {
    keys.forEach((key, index) => {
      const value = previous[index]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    })
    rmSync(directory, { recursive: true })
  }
})
