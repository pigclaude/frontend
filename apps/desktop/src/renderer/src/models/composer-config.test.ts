// 负责验证输入区适配层：四档权限与计划开关的映射、思考深度、账号实例和模型目录。

import { describe, expect, it } from "vitest"
import type { ClaudeModel } from "../../../main/session/session-types"
import {
  AUTO_ACCOUNT,
  DEFAULT_PERMISSION_LEVEL,
  accountIdForAgent,
  agentIdForAccount,
  composerAgents,
  composerCatalog,
  composerLevel,
  currentAccountAgent,
  effortForComposer,
  permissionView,
  sessionPermissionMode,
} from "./composer-config"

const model = (id: string, isDefault = false): ClaudeModel => ({
  id,
  displayName: id.toUpperCase(),
  description: `${id} 说明`,
  isDefault,
  efforts: ["low", "medium", "high", "xhigh", "max"],
})

describe("composer permission mapping", () => {
  it("starts new sessions on Claude Code's own default level", () => {
    expect(DEFAULT_PERMISSION_LEVEL).toBe("approval-required")
    expect(sessionPermissionMode(DEFAULT_PERMISSION_LEVEL, false)).toBe("default")
  })

  it("maps the levels the session host runs to Claude Code modes", () => {
    expect(sessionPermissionMode("approval-required", false)).toBe("default")
    expect(sessionPermissionMode("auto-accept-edits", false)).toBe("acceptEdits")
    expect(sessionPermissionMode("full-access", false)).toBe("bypassPermissions")
  })

  it("runs every level in Claude Code's plan mode while the plan switch is on", () => {
    expect(sessionPermissionMode("approval-required", true)).toBe("plan")
    expect(sessionPermissionMode("auto-accept-edits", true)).toBe("plan")
    expect(sessionPermissionMode("full-access", true)).toBe("plan")
  })

  it("splits a Claude Code mode into a level and the plan switch", () => {
    expect(permissionView("default", "full-access")).toEqual({
      level: "approval-required",
      plan: false,
    })
    expect(permissionView("acceptEdits", "full-access")).toEqual({
      level: "auto-accept-edits",
      plan: false,
    })
    expect(permissionView("bypassPermissions", "approval-required")).toEqual({
      level: "full-access",
      plan: false,
    })
  })

  it("keeps the level remembered before plan mode while plan mode is on", () => {
    expect(permissionView("plan", "auto-accept-edits")).toEqual({
      level: "auto-accept-edits",
      plan: true,
    })
  })

  it("accepts only the four composer level ids", () => {
    expect(composerLevel("auto-accept-edits")).toBe("auto-accept-edits")
    expect(composerLevel("auto")).toBe("auto")
    expect(composerLevel("workspace-write")).toBeNull()
    expect(composerLevel("plan")).toBeNull()
  })
})

describe("composer thinking depth", () => {
  it("passes every SDK effort through and leaves the default unset", () => {
    expect(effortForComposer("low")).toBe("low")
    expect(effortForComposer("medium")).toBe("medium")
    expect(effortForComposer("high")).toBe("high")
    expect(effortForComposer("xhigh")).toBe("xhigh")
    expect(effortForComposer("max")).toBe("max")
    expect(effortForComposer(null)).toBeUndefined()
    expect(effortForComposer("none")).toBeUndefined()
  })
})

describe("composer accounts and models", () => {
  it("puts auto selection first and marks direct accounts", () => {
    expect(
      composerAgents([
        { id: "account-a", displayName: "主力 Max", proxyId: "proxy-1" },
        { id: "account-b", displayName: "直连 Max", proxyId: null },
      ]),
    ).toEqual([
      {
        id: AUTO_ACCOUNT,
        agentId: "claude",
        label: "自动选择账号",
        executionModes: { plan: true },
      },
      { id: "account-a", agentId: "claude", label: "主力 Max", executionModes: { plan: true } },
      {
        id: "account-b",
        agentId: "claude",
        label: "直连 Max · 系统网络",
        executionModes: { plan: true },
      },
    ])
  })

  it("keeps the plan switch on the stand-in for an account that left the pool", () => {
    expect(currentAccountAgent("account-gone")).toEqual({
      id: "account-gone",
      agentId: "claude",
      label: "当前账号",
      executionModes: { plan: true },
    })
  })

  it("maps account ids to instances and back", () => {
    expect(accountIdForAgent(AUTO_ACCOUNT)).toBe("")
    expect(accountIdForAgent("account-a")).toBe("account-a")
    expect(agentIdForAccount("")).toBe(AUTO_ACCOUNT)
    expect(agentIdForAccount("account-a")).toBe("account-a")
  })

  it("gives every instance the same model list with thinking depths", () => {
    const agents = composerAgents([{ id: "account-a", displayName: "主力 Max", proxyId: null }])
    const catalog = composerCatalog(agents, [model("claude-sonnet", true), model("claude-opus")])

    expect(Object.keys(catalog).sort()).toEqual([AUTO_ACCOUNT, "account-a"].sort())
    expect(catalog[AUTO_ACCOUNT]?.map((item) => item.id)).toEqual(["claude-sonnet", "claude-opus"])
    expect(catalog[AUTO_ACCOUNT]?.[0]).toMatchObject({
      label: "CLAUDE-SONNET",
      isDefault: true,
      efforts: ["low", "medium", "high", "xhigh", "max"],
    })
    expect(catalog["account-a"]).toEqual(catalog[AUTO_ACCOUNT])
  })

  it("keeps the catalog undefined while models are loading", () => {
    const agents = composerAgents([])
    const catalog = composerCatalog(agents, null)

    expect(catalog[AUTO_ACCOUNT]).toBeUndefined()
  })
})
