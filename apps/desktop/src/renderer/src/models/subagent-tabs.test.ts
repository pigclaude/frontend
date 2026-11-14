// 负责验证线程头子代理标签的状态：选中、从子代理卡打开、关闭，以及标签栏列出哪些子代理、
// 运行中和等待许可的标记。

import type { SubagentCall } from "@pigclaude/ui-chat"
import { describe, expect, it } from "vitest"
import {
  closeSubagentTab,
  initialSubagentTabs,
  openSubagentTab,
  selectSubagentTab,
  subagentTabs,
  type SubagentTabState,
} from "./subagent-tabs"

const main = { title: "pigclaude", description: "workspace / pigclaude" }

function call(id: string, runId: string, status: SubagentCall["status"] = "running"): SubagentCall {
  return { id, name: "general-purpose", description: `任务 ${id}`, status, events: [], runId }
}

function subagents(...calls: SubagentCall[]): Map<string, SubagentCall> {
  return new Map(calls.map((item) => [item.id, item]))
}

function view(state: SubagentTabState, calls: Map<string, SubagentCall>, waiting: string[] = []) {
  return subagentTabs({ main, subagents: calls, state, waiting: new Set(waiting) })
}

describe("subagent tabs", () => {
  it("shows only the main tab before any subagent runs", () => {
    expect(view(initialSubagentTabs, subagents())).toEqual({
      tabs: [{ id: "main", kind: "main", ...main }],
      activeId: "main",
      subagent: null,
    })
  })

  it("lists the latest run's subagents and an earlier one only after it is opened", () => {
    const calls = subagents(call("a", "run-1", "completed"), call("b", "run-2"))

    expect(view(initialSubagentTabs, calls).tabs.map((tab) => tab.id)).toEqual([
      "main",
      "spawned:b",
    ])
    const opened = openSubagentTab(initialSubagentTabs, "a")
    expect(view(opened, calls).tabs.map((tab) => tab.id)).toEqual([
      "main",
      "spawned:a",
      "spawned:b",
    ])
    expect(view(opened, calls)).toMatchObject({ activeId: "spawned:a", subagent: { id: "a" } })
  })

  it("closes a tab back to the main session and opens it again from its card", () => {
    const calls = subagents(call("b", "run-2"))
    const viewing = openSubagentTab(initialSubagentTabs, "b")
    const closed = closeSubagentTab(viewing, "spawned:b")

    expect(view(closed, calls)).toMatchObject({ activeId: "main", subagent: null })
    expect(view(closed, calls).tabs.map((tab) => tab.id)).toEqual(["main"])
    expect(view(openSubagentTab(closed, "b"), calls)).toMatchObject({
      activeId: "spawned:b",
      subagent: { id: "b" },
    })
  })

  it("keeps the selected tab when another one closes and switches between tabs", () => {
    const calls = subagents(call("a", "run-2"), call("b", "run-2"))
    const onA = selectSubagentTab(initialSubagentTabs, "spawned:a")

    expect(view(closeSubagentTab(onA, "spawned:b"), calls).activeId).toBe("spawned:a")
    expect(view(selectSubagentTab(onA, "main"), calls)).toMatchObject({
      activeId: "main",
      subagent: null,
    })
  })

  it("falls back to the main tab when the selected subagent is gone", () => {
    const state = selectSubagentTab(initialSubagentTabs, "spawned:gone")
    expect(view(state, subagents(call("b", "run-2")))).toMatchObject({
      activeId: "main",
      subagent: null,
    })
  })

  it("marks running subagents and the one waiting for a permission answer", () => {
    const calls = subagents(call("a", "run-2"), call("b", "run-2"), call("c", "run-2", "completed"))
    const tabs = view(initialSubagentTabs, calls, ["b"]).tabs

    expect(tabs.map((tab) => [tab.id, tab.running ?? false, tab.waiting ?? false])).toEqual([
      ["main", false, false],
      ["spawned:a", true, false],
      ["spawned:b", true, true],
      ["spawned:c", false, false],
    ])
    expect(tabs[1]).toMatchObject({
      kind: "spawned",
      title: "任务 a",
      description: "general-purpose · 任务 a",
      closable: true,
    })
  })
})
