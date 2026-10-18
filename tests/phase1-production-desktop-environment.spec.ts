// 负责用非敏感哨兵验证桌面环境拒绝未知变量，同时保留必要OS和公开端点。
import { test, expect } from "@playwright/test"
import {
  desktopEnvironment,
  requireProductionDesktopGate,
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
    "https://pigclaude.com",
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
