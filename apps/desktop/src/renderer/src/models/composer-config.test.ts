// 负责验证输入区适配层：权限双向映射、思考深度、账号实例和模型目录。

import { describe, expect, it } from "vitest"
import type { ClaudeModel } from "../../../main/session/session-types"
import {
  AUTO_ACCOUNT,
  accountIdForAgent,
  agentIdForAccount,
  composerAgents,
  composerCatalog,
  composerPermissionMode,
  effortForComposer,
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
  it("maps Pigcode modes to Claude session modes like the Pigcode Claude driver", () => {
    expect(sessionPermissionMode("workspace-write")).toBe("default")
    expect(sessionPermissionMode("plan")).toBe("plan")
    expect(sessionPermissionMode("read-only")).toBe("plan")
    expect(sessionPermissionMode("danger-full-access")).toBe("bypassPermissions")
  })

  it("maps Claude session modes back to the nearest Pigcode mode", () => {
    expect(composerPermissionMode("default")).toBe("workspace-write")
    expect(composerPermissionMode("acceptEdits")).toBe("workspace-write")
    expect(composerPermissionMode("plan")).toBe("plan")
    expect(composerPermissionMode("bypassPermissions")).toBe("danger-full-access")
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
      { id: AUTO_ACCOUNT, agentId: "claude", label: "自动选择账号" },
      { id: "account-a", agentId: "claude", label: "主力 Max" },
      { id: "account-b", agentId: "claude", label: "直连 Max · 系统网络" },
    ])
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
