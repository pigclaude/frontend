// 为宿主持久化测试提供隔离项目、真实会话存储和合成的 SDK 查询。

import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { collectPrompt, FakeQuery, type CapturedQuery } from "./claude-agent-adapter-fixtures"
import type { SessionFlagSettings } from "./claude-query"
import { SessionHost, type SessionHostOptions } from "./session-host"
import { FakeMembership, FakeUsage } from "./session-host-fixtures"
import { FakeRuntime } from "./session-runtime-fixture"
import { SessionStore } from "./session-store"
import { removeTemporaryDirs, temporaryDir } from "./session-store-fixtures"

/** 合成 SDK 报告的已保存模型。 */
export const savedModel = "claude-sonnet-4"
const hosts: SessionHost[] = []

/** 清理所有宿主、查询进程与本地测试目录。 */
export async function disposePersistenceFixtures(): Promise<void> {
  const open = hosts.splice(0)
  try {
    await Promise.all(open.map((host) => host.dispose()))
  } finally {
    await removeTemporaryDirs()
  }
}

/** 创建隔离的工作区和真实本机会话存储。 */
export async function workspaceFixture() {
  const userDataPath = await temporaryDir()
  const root = join(userDataPath, "session-store")
  const project = join(userDataPath, "project")
  const workspace = join(userDataPath, "worktree")
  await Promise.all([mkdir(project), mkdir(workspace)])
  return { userDataPath, root, project, workspace, store: await SessionStore.open({ root }) }
}

class PersistenceQuery extends FakeQuery {
  readonly flagSettings: SessionFlagSettings[] = []

  async applyFlagSettings(settings?: SessionFlagSettings): Promise<void> {
    if (settings !== undefined) this.flagSettings.push(settings)
  }
}

/** 装配使用真实存储与合成 SDK 的会话宿主。 */
export function hostFixture(
  fixture: Awaited<ReturnType<typeof workspaceFixture>>,
  resolveProfile: NonNullable<SessionHostOptions["resolveProfile"]>,
) {
  const queries: CapturedQuery[] = []
  const sessions: PersistenceQuery[] = []
  const prompts: SDKUserMessage[] = []
  const runtime = new FakeRuntime()
  const usage = new FakeUsage()
  const membership = new FakeMembership()
  const host = new SessionHost({
    membership,
    runtime,
    usage,
    userDataPath: fixture.userDataPath,
    defaultWorkspace: () => fixture.workspace,
    resolveBinaryPath: () => join(fixture.userDataPath, "fake-claude"),
    resolveProfile,
    readOrganizationModels: async () => [],
    sessionStore: Promise.resolve(fixture.store),
    createAdapter: (onEvent) =>
      new ClaudeAgentAdapter({
        onEvent,
        queryFn: ({ options, prompt }) => {
          queries.push({ options, prompt })
          const query = new PersistenceQuery([
            { value: savedModel, displayName: "Sonnet", description: "已保存模型" },
          ])
          if (options.persistSession) {
            sessions.push(query)
            void collectPrompt(prompt, prompts)
          }
          return query
        },
      }),
  })
  hosts.push(host)
  return { host, membership, queries, prompts, sessions, runtime, usage }
}
