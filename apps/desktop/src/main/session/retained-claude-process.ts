// 负责会话目录里的 Claude Code 进程记录，续接前只回收系统确认属于上一代的可执行进程。

import { randomUUID } from "node:crypto"
import { lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import {
  ClaudeProcessPhaseError,
  isClaudeProcessBirth,
  isClaudeProcessPid,
  readClaudeProcess,
  sameExecutable,
  stopClaudeProcess,
  type ClaudeProcessPhase,
  type RetainedClaudeProcess,
} from "./claude-process-identity"
import { fileErrorCode, isPlainRecord } from "./session-store-guards"

/** 一次已核实的 Claude Code 进程身份，供退出时条件删除记录使用。 */
export type { RetainedClaudeProcess } from "./claude-process-identity"

const sidecarName = "claude-process.json"
const maxRecordBytes = 16 * 1024
const fileMode = 0o600
const pending = new Map<string, Promise<void>>()

/** 核对启动的完整执行路径后原子写入进程记录，进程已退出时返回 null。 */
export function recordRetainedClaudeProcess(
  directory: string,
  pid: number,
  executable: string,
): Promise<RetainedClaudeProcess | null> {
  return enqueue(directory, "保存进程记录", async (path) => {
    if (!isAbsolute(executable)) throw new ClaudeProcessPhaseError("核对可执行文件")
    const identity = await inPhase("读取进程身份", () => readClaudeProcess(pid))
    if (identity === null) return null
    await inPhase("核对可执行文件", async () => {
      const expected = await realpath(executable)
      const actual =
        process.platform === "win32" ? await realpath(identity.executable) : identity.executable
      if (!sameExecutable(actual, expected)) throw new ClaudeProcessPhaseError("核对可执行文件")
    })
    if ((await inPhase("读取进程记录", () => readRecord(path))) !== null)
      throw new ClaudeProcessPhaseError("保存进程记录")
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(identity) + "\n", {
        encoding: "utf8",
        mode: fileMode,
        flag: "wx",
      })
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
    return identity
  })
}

/** 续接前验证并回收上一代；无法确认身份或退出时保留记录并拒绝续接。 */
export function reapRetainedClaudeProcess(directory: string): Promise<void> {
  return enqueue(directory, "移除进程记录", async (path) => {
    const identity = await inPhase("读取进程记录", () => readRecord(path))
    if (identity === null) return
    await inPhase("核对并停止进程", () => stopClaudeProcess(identity))
    await rm(path, { force: true })
  })
}

/** 正常退出时只清除该代的记录，迟到的退出不得清除下一代。 */
export function forgetRetainedClaudeProcess(
  directory: string,
  identity: RetainedClaudeProcess,
): Promise<void> {
  return enqueue(directory, "移除进程记录", async (path) => {
    const stored = await inPhase("读取进程记录", () => readRecord(path))
    if (
      stored?.pid === identity.pid &&
      stored.startedAt === identity.startedAt &&
      sameExecutable(stored.executable, identity.executable)
    )
      await rm(path, { force: true })
  })
}

async function inPhase<T>(phase: ClaudeProcessPhase, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    // 系统命令异常含命令行及输出，只向会话层交固定错误。
    if (error instanceof ClaudeProcessPhaseError) throw error
    throw new ClaudeProcessPhaseError(phase)
  }
}

function enqueue<T>(
  directory: string,
  phase: ClaudeProcessPhase,
  action: (path: string) => Promise<T>,
): Promise<T> {
  const path = join(resolve(directory), sidecarName)
  const key = process.platform === "win32" ? path.toLowerCase() : path
  const result = (pending.get(key) ?? Promise.resolve()).then(() =>
    inPhase(phase, () => action(path)),
  )
  const next = result.then(
    () => undefined,
    () => undefined,
  )
  pending.set(key, next)
  void next.then(() => {
    if (pending.get(key) === next) pending.delete(key)
  })
  return result
}

async function readRecord(path: string): Promise<RetainedClaudeProcess | null> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.size > maxRecordBytes) throw new Error("会话进程记录不可读")
    const identity: unknown = JSON.parse(await readFile(path, "utf8"))
    if (
      !isPlainRecord(identity) ||
      !isClaudeProcessPid(identity.pid) ||
      typeof identity.executable !== "string" ||
      !isAbsolute(identity.executable) ||
      !isClaudeProcessBirth(identity.startedAt)
    )
      throw new Error("会话进程记录的格式不正确")
    return {
      pid: identity.pid,
      executable: identity.executable,
      startedAt: identity.startedAt,
    }
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") return null
    throw error
  }
}
