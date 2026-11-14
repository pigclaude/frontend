// 会话存储测试共用的夹具：真实临时目录、一份完整的新会话索引和按序号构造的信封。

import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sessionEnvelopeVersion, type SessionEnvelope } from "./session-envelope"
import type { NewSessionIndex } from "./session-store"
import type { SessionHostEvent } from "./session-types"

/** 测试统一使用的会话创建时间。 */
export const createdAt = "2026-11-14T08:00:00.000Z"

const temporaryDirs: string[] = []

/** 新建一个真实的临时目录，removeTemporaryDirs 时删除。 */
export async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-store-"))
  temporaryDirs.push(dir)
  return dir
}

/** 删除本文件创建的全部临时目录。 */
export async function removeTemporaryDirs(): Promise<void> {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
}

/** 一份所有字段都填好的新会话索引；overrides 覆盖其中的字段。 */
export function newSessionIndex(
  id: string,
  overrides: Partial<NewSessionIndex> = {},
): NewSessionIndex {
  return {
    id,
    title: "整理发布清单",
    titleSource: "auto",
    projectPath: "/Users/example/project",
    createdAt,
    updatedAt: createdAt,
    lastActivityAt: createdAt,
    archivedAt: null,
    status: "parked",
    lastTurn: null,
    environment: {
      browserProfileId: "profile-1",
      browserProfileRevision: 3,
      timezone: "Asia/Shanghai",
      locale: "zh-CN",
    },
    preferredAccountId: "account-1",
    activeAccountId: "account-1",
    model: "claude-sonnet-4-5",
    thinking: null,
    effort: "high",
    fast: false,
    permissionMode: "default",
    planMode: false,
    origin: "manual",
    claudeCodeVersion: "2.1.310",
    referencedSessionIds: [],
    ...overrides,
  }
}

/** 按序号构造一条会话信封；时间从 createdAt 起每个序号加一秒。 */
export function envelopeOf(
  sessionId: string,
  seq: number | null,
  event: SessionHostEvent,
): SessionEnvelope {
  return {
    version: sessionEnvelopeVersion,
    sessionId,
    seq,
    at: new Date(Date.parse(createdAt) + (seq ?? 0) * 1000).toISOString(),
    event,
  }
}

/** 文件或目录的权限位（只取低 9 位）。 */
export async function modeOf(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777
}
