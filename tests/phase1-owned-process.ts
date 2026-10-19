// 负责仅按唯一测试 owner 标记识别并回收冷启动进程，确认退出后才允许删除 profile。
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"

const execute = promisify(execFile)

/** 仅返回精确可执行文件且具有本次唯一 CLI 标记的 PID，不输出进程参数。 */
export async function findOwnedProcessIds(executable: string, marker: string): Promise<number[]> {
  const { stdout } = await execute("/bin/ps", ["-axo", "pid=,comm="])
  const candidates = stdout.split("\n").flatMap((line) => {
    const matched = /^\s*(\d+)\s+(.+)$/.exec(line)
    return matched?.[2] === executable ? [Number(matched[1])] : []
  })
  const owned: number[] = []
  for (const pid of candidates) {
    let command: string
    try {
      command = (await execute("/bin/ps", ["-p", String(pid), "-o", "command="])).stdout
    } catch {
      try {
        process.kill(pid, 0)
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") continue
      }
      throw new Error("无法确认候选进程归属")
    }
    if (!command.trim()) throw new Error("候选进程归属信息为空")
    if (command.trim().split(/\s+/).includes(marker)) owned.push(pid)
  }
  return owned
}

/** 测试进程探测依赖，允许故障注入验证 ps 失败，不替换真实业务或协议。 */
export type ProcessOwnerOptions = {
  probe?: typeof findOwnedProcessIds
  timeoutMs?: number
}

/** 只管理唯一 CLI 标记归属的进程；未确认退出时禁止删除其 profile。 */
export class OwnedProcess {
  readonly marker = `--pigclaude-acceptance-owner=${randomUUID()}`
  readonly #executable: string
  readonly #probe: typeof findOwnedProcessIds
  readonly #timeoutMs: number
  readonly #observed = new Set<number>()
  #attempted = false
  #confirmed = true

  /** 创建本次启动的唯一身份；不按 bundleId 或进程名广泛回收。 */
  constructor(executable: string, options: ProcessOwnerOptions = {}) {
    this.#executable = executable
    this.#probe = options.probe ?? findOwnedProcessIds
    this.#timeoutMs = options.timeoutMs ?? 3_000
  }

  /** 在调用 OS opener 前登记风险，之后任何失败都必须确认进程退出。 */
  beginLaunch(): void {
    this.#attempted = true
    this.#confirmed = false
  }

  /** 当前是否已确认本次启动进程退出，未启动时允许清理空 profile。 */
  get cleanupConfirmed(): boolean {
    return this.#confirmed
  }

  /** 发现并持续登记本次归属 PID；不把探测失败误判为无进程。 */
  async capture(): Promise<number[]> {
    const pids = await this.#probe(this.#executable, this.marker)
    for (const pid of pids) this.#observed.add(pid)
    return pids
  }

  /** 失败后仍独立发现 owner，只对信号前再次确证的 PID 升级终止，并等待退出。 */
  async cleanup(): Promise<boolean> {
    if (!this.#attempted) return true
    this.#confirmed = false
    if (!(await this.#poll(() => this.#observed.size > 0))) return false
    for (const signal of ["SIGTERM", "SIGKILL"] as const) {
      try {
        for (const pid of await this.capture()) {
          if (!(await this.capture()).includes(pid)) continue
          try {
            process.kill(pid, signal)
          } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false
          }
        }
      } catch {
        return false
      }
      if (await this.#poll((pids) => pids.length === 0)) {
        this.#confirmed = true
        return true
      }
    }
    return false
  }

  async #poll(accept: (pids: number[]) => boolean): Promise<boolean> {
    const deadline = Date.now() + this.#timeoutMs
    do {
      try {
        if (accept(await this.capture())) return true
      } catch {
        // 探测失败不能当作进程已退出；仅在截止时间内继续独立确认。
      }
      if (Date.now() >= deadline) return false
      await delay(20)
    } while (true)
  }
}

/** 仅在进程已确认退出后删除本次 profile，失败时保留目录供继续清理。 */
export async function removeProfileWhenStopped(
  profile: string,
  confirmed: boolean,
): Promise<boolean> {
  if (!confirmed) return false
  await rm(profile, { recursive: true, force: true })
  return true
}

/** 回收启动前已登记的全部 owner，包括尚未返回桌面 harness 的失败启动。 */
export async function cleanupOwnedProcesses(owners: Iterable<OwnedProcess>): Promise<boolean> {
  let confirmed = true
  for (const owner of owners) {
    if (!(await owner.cleanup())) confirmed = false
  }
  return confirmed
}

/** 即使正常 close 失败，也等待唯一归属进程真正退出；未确认则返回 false。 */
export async function cleanupFailedLaunch(
  owner: OwnedProcess,
  closeApplication: () => Promise<void>,
): Promise<boolean> {
  await closeApplication().catch(() => undefined)
  return owner.cleanup()
}
