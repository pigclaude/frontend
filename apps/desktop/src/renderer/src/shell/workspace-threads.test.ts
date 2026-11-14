// 验证工作区与当前会话映射成侧栏的项目、会话和状态点；折叠项目与从项目新建会话的规则。
import { describe, expect, it } from "vitest"
import { createSessionState, type SessionTurn, type SessionUiState } from "../models/session-model"
import {
  newSessionWorkspace,
  sessionAgentNames,
  sessionStatus,
  sessionThread,
  sessionTitle,
  toggleExpanded,
  workspaceProjects,
} from "./workspace-threads"

function turn(patch: Partial<SessionTurn> = {}): SessionTurn {
  return {
    id: "t1",
    startedAt: "2026-11-14T01:00:00.000Z",
    endedAt: null,
    userText: "帮我看看 README",
    blocks: [],
    tools: [],
    permissions: [],
    switches: [],
    errors: [],
    result: null,
    status: "streaming",
    seenMessageIds: [],
    ...patch,
  }
}

function session(patch: Partial<SessionUiState> = {}): SessionUiState {
  return { ...createSessionState(), sessionId: "s-1", started: true, ...patch }
}

describe("workspaceProjects", () => {
  it("每个最近工作区是一个项目，路径就是 id，名字取文件夹名", () => {
    expect(workspaceProjects(["/work/api", "/work/web/"])).toEqual([
      { id: "/work/api", rootPath: "/work/api", name: "api", createdAt: expect.any(String) },
      { id: "/work/web/", rootPath: "/work/web/", name: "web", createdAt: expect.any(String) },
    ])
  })

  it("改过名的项目用侧栏显示名，其余仍取文件夹名", () => {
    expect(
      workspaceProjects(["/work/api", "/work/web"], { "/work/api": "后端" }).map(
        (project) => project.name,
      ),
    ).toEqual(["后端", "web"])
  })
})

describe("sessionThread", () => {
  it("当前会话挂在运行它的工作区下，标题取首条消息", () => {
    const thread = sessionThread({
      session: session({ turns: [turn()] }),
      workspace: "/work/api",
      startedAt: "2026-11-11T08:00:00.000Z",
      untitled: "新会话",
      accounts: [],
    })
    expect(thread).toMatchObject({
      id: "s-1",
      projectId: "/work/api",
      title: "帮我看看 README",
      defaultAgentId: "claude",
      archivedAt: null,
      updatedAt: "2026-11-11T08:00:00.000Z",
    })
  })

  it("会话的 Claude Code 模式映射成输入框的档位和独立的计划开关", () => {
    const base = {
      workspace: "/work/api",
      startedAt: "2026-11-11T08:00:00.000Z",
      untitled: "",
      accounts: [],
    }
    expect(
      sessionThread({ ...base, session: session({ permissionMode: "acceptEdits" }) }),
    ).toMatchObject({ permissionMode: "auto-accept-edits", planMode: false })
    expect(sessionThread({ ...base, session: session({ permissionMode: "plan" }) })).toMatchObject({
      planMode: true,
    })
  })

  it("账号角标跟随会话实际在用的账号，只用账号的显示名", () => {
    const accounts = [
      { id: "acc-work", displayName: "工作号" },
      { id: "acc-home", displayName: "家用号" },
    ]
    const base = {
      workspace: "/work/api",
      startedAt: "2026-11-11T08:00:00.000Z",
      untitled: "",
      accounts,
    }
    expect(sessionThread({ ...base, session: session({ accountId: "acc-work" }) })).toMatchObject({
      lastAgentId: "claude",
      lastInstanceId: "acc-work",
    })
    expect(sessionThread({ ...base, session: session({ accountId: "acc-home" }) })).toMatchObject({
      lastInstanceId: "acc-home",
    })
    expect(sessionThread({ ...base, session: session({ accountId: "acc-gone" }) })).toMatchObject({
      lastInstanceId: null,
    })
    expect(sessionThread({ ...base, session: session() })).toMatchObject({ lastInstanceId: null })
    expect(sessionAgentNames(accounts)).toEqual({
      claude: "Claude Code",
      "acc-work": "工作号",
      "acc-home": "家用号",
    })
  })

  it("还没开始或不知道工作区时侧栏没有会话", () => {
    const base = { startedAt: "2026-11-11T08:00:00.000Z", untitled: "新会话", accounts: [] }
    expect(sessionThread({ ...base, session: createSessionState(), workspace: "/w" })).toBeNull()
    expect(sessionThread({ ...base, session: session(), workspace: null })).toBeNull()
  })

  it("还没有消息时用未命名标题，长消息截断并只取第一行", () => {
    expect(sessionTitle({ turns: [] }, "新会话")).toBe("新会话")
    expect(sessionTitle({ turns: [turn({ userText: "第一行\n第二行" })] }, "新会话")).toBe("第一行")
    expect(sessionTitle({ turns: [turn({ userText: "字".repeat(60) })] }, "新会话")).toBe(
      `${"字".repeat(40)}…`,
    )
  })
})

describe("sessionStatus", () => {
  it("有待回答的许可时等待许可，回复中时运行中", () => {
    const pending = turn({
      permissions: [
        {
          requestId: "r1",
          toolName: "Bash",
          input: {},
          suggestions: [],
          blockedPath: null,
          status: "pending",
          requestedAt: "2026-11-14T01:00:00.000Z",
          resolvedAt: null,
        },
      ],
    })
    expect(sessionStatus(session({ activeTurnId: "t1", turns: [pending] }))).toBe(
      "waiting-approval",
    )
    expect(sessionStatus(session({ activeTurnId: "t1", turns: [turn()] }))).toBe("running")
  })

  it("出错结束时失败，还没有回合时空闲", () => {
    expect(sessionStatus(session({ ended: true, endedReason: "error" }))).toBe("failed")
    expect(sessionStatus(session({ ended: true, endedReason: "completed" }))).toBe("idle")
    expect(sessionStatus(session())).toBe("idle")
  })

  it("回合结束后按最后一轮的结果显示已完成、失败或已中断", () => {
    expect(sessionStatus(session({ turns: [turn({ status: "done" })] }))).toBe("completed")
    expect(sessionStatus(session({ turns: [turn({ status: "error" })] }))).toBe("failed")
    expect(sessionStatus(session({ turns: [turn({ status: "cancelled" })] }))).toBe("interrupted")
    expect(
      sessionStatus(
        session({
          ended: true,
          endedReason: "stopped",
          turns: [turn({ id: "t1", status: "done" }), turn({ id: "t2", status: "cancelled" })],
        }),
      ),
    ).toBe("interrupted")
  })
})

describe("侧栏操作", () => {
  it("折叠项目时只改变这个项目的展开状态", () => {
    expect(toggleExpanded({ api: true, web: true }, "api", false)).toEqual({
      api: false,
      web: true,
    })
  })

  it("从项目新建会话时保留项目上下文，未知项目沿用当前工作区", () => {
    expect(newSessionWorkspace("/work/api", ["/work/api"], "/work/web")).toBe("/work/api")
    expect(newSessionWorkspace("/gone", ["/work/api"], "/work/web")).toBe("/work/web")
    expect(newSessionWorkspace(undefined, ["/work/api"], null)).toBeNull()
  })
})
