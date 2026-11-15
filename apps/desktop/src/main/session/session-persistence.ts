// 负责桌面会话的索引、历史读取和续接材料；Claude 会话记录只交给 SDK。

import { stat } from "node:fs/promises"
import { join } from "node:path"
import type { ClaudePersistenceOptions } from "./claude-query-options"
import type { SessionSavedSettings } from "./claude-session-options"
import { retainedClaudeProject } from "./session-environment"
import type { SessionEnvelope } from "./session-envelope"
import type { SessionUsage } from "./session-events"
import { maxEnvelopesPerRead, type SessionEventCursor } from "./session-event-log"
import { SessionHistoryWriteError } from "./session-history-write-error"
import type { SessionIndex, SessionStoreStatus } from "./session-index"
import type { SessionLaunchStorage } from "./session-launch"
import { normalizeSessionLocale, normalizeSessionTimezone } from "./session-locale"
import type { SessionStore, SessionIndexPatch } from "./session-store"
import type { SessionStorePaths } from "./session-store-layout"
import type {
  ClaudeModel,
  SessionModelCatalog,
  SessionProfile,
  SessionStartInput,
  SessionTools,
} from "./session-types"
import { SessionHostError } from "./session-types"
import { reapRetainedClaudeProcess } from "./retained-claude-process"
import { checkSessionStart, type SessionStartDeps } from "./session-start-checks"

/** 启动使用的已保存路径、SDK 选项和时间线游标。 */
export type PersistedSessionLaunch = ClaudePersistenceOptions & {
  paths: SessionStorePaths
  cursor: SessionEventCursor
  usageBaseline?: SessionUsage
}

/** 由磁盘索引恢复的启动参数，以及模型替换的提示。 */
export type ResumeInput = { input: SessionStartInput; modelFellBack: boolean }

/** Claude Code 用 UUID 保存和续接会话。 */
export function checkFreshSessionId(
  store: SessionStore | undefined,
  id: string,
  tools?: SessionTools,
): void {
  if (store === undefined) return
  const valid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)
  if (!valid || store.get(id) !== null) {
    tools?.close()
    throw new SessionHostError("SESSION_START_FAILED", "无法用该会话 id 创建新会话")
  }
}

/** 续接使用已保存的设置，查询模型后准备会话工具并启动原 id。 */
export async function resumeSavedSession(
  index: SessionIndex,
  deps: SessionStartDeps,
  models: () => Promise<SessionModelCatalog>,
  tools: (() => SessionTools | undefined) | undefined,
  launch: (
    input: SessionStartInput,
    tools: SessionTools | undefined,
  ) => Promise<{ sessionId: string }>,
  onFallback: () => void,
): Promise<{ sessionId: string }> {
  await checkSessionStart(
    { ...deps, requiredProfile: index.environment },
    resumeInput(index, null).input,
  )
  const catalog = index.model === null ? null : await models().catch(() => null)
  const { input, modelFellBack } = resumeInput(
    index,
    catalog?.cliError === null ? catalog.models : null,
  )
  const resumed = await launch(input, tools?.())
  if (modelFellBack) onFallback()
  return resumed
}

/** 启动失败时只回滚本次状态，原有历史目录留给用户重试。 */
export async function rollbackSavedLaunch(
  storage: SessionLaunchStorage,
  id: string,
): Promise<void> {
  if (storage.store.get(id)?.status !== "running") return
  if (storage.index === null) {
    await storage.store.delete(id)
  } else {
    const saved = storage.index
    await storage.store.update(id, {
      status: saved.status,
      lastActivityAt: saved.lastActivityAt,
      updatedAt: saved.updatedAt,
      model: saved.model,
      permissionMode: saved.permissionMode,
      planMode: saved.planMode,
    })
  }
}

/** 从原索引恢复工作区、模型和控制设置。计划和高权限档在新进程里降回监督审批。 */
export function resumeInput(
  index: SessionIndex,
  models: readonly ClaudeModel[] | null,
): ResumeInput {
  const model = index.model
  const modelFellBack =
    model !== null &&
    models !== null &&
    !models.some((item) => item.id === model || item.resolvedModel === model)
  const preferred = index.preferredAccountId ?? index.activeAccountId
  return {
    modelFellBack,
    input: {
      workspace: index.workspace ?? index.projectPath,
      projectPath: index.projectPath,
      permissionMode: index.permissionMode === "acceptEdits" ? "acceptEdits" : "default",
      ...(preferred === null ? {} : { accountId: preferred }),
      ...(index.thinking === null ? {} : { thinking: index.thinking }),
      ...(index.effort === null ? {} : { effort: index.effort }),
      ...(model === null || modelFellBack ? {} : { model }),
      fast: index.fast,
    },
  }
}

/** 打开已有记录时仍使用原目录；新会话先创建索引，异常退出时才能扫描到它。 */
export async function prepareSavedSession(
  store: SessionStore,
  sessionId: string,
  input: SessionStartInput,
  profile: SessionProfile,
  index: SessionIndex | null,
  now: number,
): Promise<PersistedSessionLaunch> {
  const paths = store.paths(sessionId)
  if (index === null) {
    const at = new Date(now).toISOString()
    await store.create({
      id: sessionId,
      title: "",
      titleSource: "auto",
      projectPath: input.projectPath ?? input.workspace,
      workspace: input.workspace,
      createdAt: at,
      updatedAt: at,
      lastActivityAt: at,
      archivedAt: null,
      status: "running",
      lastTurn: null,
      environment: {
        browserProfileId: profile.browserProfileId ?? null,
        browserProfileRevision: profile.profileRevision ?? null,
        timezone: normalizeSessionTimezone(profile.timezone),
        locale: normalizeSessionLocale(profile.locale),
      },
      preferredAccountId: input.accountId ?? null,
      activeAccountId: null,
      model: input.model ?? null,
      thinking: input.thinking ?? null,
      effort: input.effort ?? null,
      fast: input.fast ?? false,
      permissionMode: input.permissionMode === "plan" ? "default" : input.permissionMode,
      planMode: input.permissionMode === "plan",
      origin: "manual",
      claudeCodeVersion: null,
      referencedSessionIds: [],
    })
  } else {
    await verifyRetainedSession(paths, sessionId)
    await store.update(sessionId, {
      status: "running",
      permissionMode: input.permissionMode === "plan" ? "default" : input.permissionMode,
      planMode: false,
      model: input.model ?? null,
    })
  }
  const { seq, at, usageBaseline } = await store.cursor(sessionId)
  return {
    directory: paths.directory,
    sessionId,
    resume: index !== null,
    paths,
    cursor: { seq, at },
    ...(usageBaseline === undefined ? {} : { usageBaseline }),
  }
}

async function verifyRetainedSession(paths: SessionStorePaths, sessionId: string): Promise<void> {
  try {
    await reapRetainedClaudeProcess(paths.directory)
  } catch {
    throw new SessionHostError("SESSION_RESUME_FAILED", "无法确认原 Claude Code 进程已停止")
  }
  const file = join(
    paths.claudeConfigDir,
    "projects",
    retainedClaudeProject(sessionId),
    `${sessionId}.jsonl`,
  )
  const info = await stat(file).catch(() => null)
  if (info === null || !info.isFile() || info.size === 0) {
    throw new SessionHostError("SESSION_RESUME_FAILED", "找不到原 Claude Code 会话记录")
  }
}

/** 保存本轮状态、已确认设置和时间线。用量和 Claude 记录各自由现有写入路径维护。 */
export class SessionPersistence {
  #loaded: SessionStore | null = null
  readonly #writes = new Map<string, Promise<void>>()
  readonly #quitWrites = new Map<string, Array<() => Promise<unknown>>>()
  #quitting = false

  /** 等待应用启动时打开的存储；登录和窗口仍可独立启动。 */
  readonly ready: Promise<SessionStore | null>

  /** 绑定应用级存储和固定的写入失败通知。 */
  constructor(
    opened: Promise<SessionStore | null>,
    private readonly warn: () => void,
  ) {
    this.ready = opened.then(
      (store) => {
        this.#loaded = store
        return store
      },
      () => null,
    )
  }

  /** 取得已打开的索引；用于同步的列表或状态快照。 */
  get store(): SessionStore | null {
    return this.#loaded
  }

  /** 应用开始退出时保留写入失败的记录，供退出重试。 */
  prepareQuit(): void {
    this.#quitting = true
  }

  /** 等待 SDK 结束后生成的记录，重试最终的时间线和停放状态写入。 */
  async flushQuitWrites(): Promise<void> {
    await Promise.all(this.#writes.values())
    await Promise.all([...this.#quitWrites.keys()].map((id) => this.#flushBeforeQuit(id)))
  }

  /** 绑定单个会话的索引设置和关停前写入检查。 */
  sessionHooks(id: string) {
    return {
      saveSettings: (settings: SessionSavedSettings) => this.#saveSettings(id, settings),
      flushHistory: (canDelayStop: boolean) =>
        this.#quitting && canDelayStop ? this.#flushBeforeQuit(id) : this.flush(id),
    }
  }

  /** 写入已保存信封并更新索引状态，排队顺序由 SessionStore 保证。 */
  observe(id: string, envelope: SessionEnvelope): void {
    const store = this.#loaded
    if (store === null || envelope.seq === null) return
    let append: "initial" | "retry" | "done" = "initial"
    void this.#save(id, async () => {
      if (append !== "done") {
        const retry = append === "retry"
        append = "retry"
        await store.appendTimeline(id, envelope, retry)
        append = "done"
      }
      const { event, at } = envelope
      await store.update(id, (index) => indexPatch(index, event, at))
    })
  }

  #saveSettings(id: string, settings: SessionSavedSettings): void {
    const store = this.#loaded
    if (store !== null) {
      void this.#save(id, async () => {
        const index = store.get(id)
        if (
          index !== null &&
          (settings.model !== index.model ||
            settings.effort !== index.effort ||
            settings.fast !== index.fast)
        )
          await store.update(id, settings)
      })
    }
  }

  /** 等待已排队的时间线写入后写入停放状态。 */
  async park(id: string, status: SessionStoreStatus): Promise<void> {
    const store = this.#loaded
    if (store === null || store.get(id) === null) return
    await this.#save(id, () => store.update(id, { status }))
  }

  /** 等待这个会话在调用前已收到的更新写完。 */
  flush(id: string): Promise<void> {
    return this.#writes.get(id) ?? Promise.resolve()
  }

  /** 历史从磁盘分页，实时补拉同时包含尚未写入的会话尾部。 */
  async history(
    id: string,
    afterSeq: number,
    live: (since: number) => SessionEnvelope[] | null,
  ): Promise<SessionEnvelope[]> {
    const store = await this.ready
    if (store?.get(id) == null) {
      const buffered = live(afterSeq)
      if (buffered === null) throw new SessionHostError("SESSION_NOT_FOUND", "会话不存在")
      return buffered
    }
    await this.flush(id)
    const page = await store.readTimeline(id, { afterSeq })
    const buffered = live(Math.max(page.lastSeq, afterSeq)) ?? []
    return [...page.envelopes, ...buffered].slice(0, maxEnvelopesPerRead)
  }

  #save(id: string, write: () => Promise<unknown>): Promise<void> {
    return this.#enqueue(id, async () => {
      const waiting = this.#quitWrites.get(id)
      if (waiting !== undefined) {
        waiting.push(write)
        return
      }
      try {
        await write()
      } catch {
        if (this.#quitting) this.#quitWrites.set(id, [write])
        this.warn()
      }
    })
  }

  #flushBeforeQuit(id: string): Promise<void> {
    return this.#enqueue(id, async () => {
      const waiting = this.#quitWrites.get(id)
      if (waiting === undefined) return
      if (this.#loaded?.get(id) == null) {
        this.#quitWrites.delete(id)
        return
      }
      try {
        while (waiting[0] !== undefined) {
          await waiting[0]()
          waiting.shift()
        }
      } catch (cause) {
        throw new SessionHistoryWriteError(cause)
      }
      this.#quitWrites.delete(id)
    })
  }

  #enqueue(id: string, write: () => Promise<void>): Promise<void> {
    const result = this.flush(id).then(write)
    const done = result
      .catch(() => undefined)
      .finally(() => {
        if (this.#writes.get(id) === done) this.#writes.delete(id)
      })
    this.#writes.set(id, done)
    return result
  }
}

function indexPatch(
  index: SessionIndex,
  event: SessionEnvelope["event"],
  at: string,
): SessionIndexPatch | null {
  switch (event.type) {
    case "started":
      return { model: event.model, lastActivityAt: at }
    case "mode":
      if (event.permissionMode === "plan") return { planMode: true }
      if (event.permissionMode === "dontAsk") return null
      return { permissionMode: event.permissionMode, planMode: false }
    case "account-switched":
      return { activeAccountId: event.to, lastActivityAt: at }
    case "turn-started": {
      const first = event.userText?.trim().split("\n")[0]?.trim() ?? ""
      const title = Array.from(first).slice(0, 40).join("")
      return {
        lastActivityAt: at,
        ...(title !== "" && index.title === "" && index.titleSource === "auto" ? { title } : {}),
      }
    }
    case "turn-ended":
      return { lastActivityAt: at, lastTurn: { status: event.status, errorCode: event.errorCode } }
    case "ended":
      return { lastActivityAt: at }
    default:
      return null
  }
}
