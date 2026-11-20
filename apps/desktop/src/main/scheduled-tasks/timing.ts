// 使用 Pigcode 的本地规则计算下次触发，并从十二小时窗口选出一次补跑。

import { execFile } from "node:child_process"
import { performance } from "node:perf_hooks"
import { promisify } from "node:util"
import { nextScheduleRunBefore, type ScheduleRule } from "@pigclaude/ui-contracts"
import type { ScheduledTask, ScheduledTaskInput } from "../../scheduled-tasks-contract"

/** 巡检本机时间所用的墙钟、单调时钟和定时器。 */
export type ScheduleClock = {
  now(): number
  monotonicNow(): number
  timeZone(signal?: AbortSignal): string | Promise<string>
  after(delay: number, callback: () => void): () => void
}

/** 实际调度使用主进程本机时区。 */
export const systemScheduleClock: ScheduleClock = {
  now: Date.now,
  monotonicNow: () => performance.now(),
  timeZone: readSystemTimeZone,
  after: (delay, callback) => {
    const timer = setTimeout(callback, delay)
    timer.unref()
    return () => clearTimeout(timer)
  },
}

const run = promisify(execFile)
const systemTimeZoneProbe =
  "process.stdout.write(Intl.DateTimeFormat().resolvedOptions().timeZone ?? '')"

async function readSystemTimeZone(signal?: AbortSignal): Promise<string> {
  if (process.env["TZ"] === undefined) {
    if (process.platform === "win32") await refreshWindowsTimeZone(signal)
    else {
      // 触发 POSIX 上 Node 对系统时区的重新检测。
      delete process.env["TZ"]
    }
  }
  return (
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    process.env["TZ"] ??
    `offset:${new Date().getTimezoneOffset()}`
  )
}

async function refreshWindowsTimeZone(signal?: AbortSignal): Promise<void> {
  // Windows 上旧进程的 ICU 会保留原时区，使用同一个随包运行时读取系统现值。
  const zone = await run(process.execPath, ["-e", systemTimeZoneProbe], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
    timeout: 5000,
    signal,
  }).then(
    ({ stdout }) => stdout.trim(),
    () => "",
  )
  if (!zone || signal?.aborted || process.env["TZ"] !== undefined) return
  if (zone === Intl.DateTimeFormat().resolvedOptions().timeZone) return
  // 设置时更新 ICU 默认值。随后删除显式值，保留子进程继承系统配置的行为。
  process.env["TZ"] = zone
  delete process.env["TZ"]
}

/** 到点定时器同时作为最长一分钟的墙钟巡检。 */
export const scheduledTaskPollMs = 60_000
const catchupMs = 12 * 60 * scheduledTaskPollMs

/** 使用本地日历与结束时刻计算严格晚于 after 的下一次触发。 */
export function nextTaskRun(
  input: Pick<ScheduledTaskInput, "rule" | "endsAt" | "enabled">,
  after: number,
  handledLocallyThrough: string | null = null,
): string | null {
  if (!input.enabled) return null
  const from =
    handledLocallyThrough === null ? after : Math.max(after, Date.parse(handledLocallyThrough))
  const next = nextScheduleRunBefore(input.rule, new Date(from), input.endsAt)
  return next?.toISOString() ?? null
}

/** 日历规则记录本地时刻。按实际间隔重复的规则只使用绝对时间游标。 */
export function localScheduleSlot(rule: ScheduleRule, at: number): string | null {
  if (rule.kind === "everyMinutes" || rule.kind === "everyHours") return null
  const date = new Date(at)
  const part = (value: number) => String(value).padStart(2, "0")
  const day = [
    String(date.getFullYear()).padStart(4, "0"),
    part(date.getMonth() + 1),
    part(date.getDate()),
  ].join("-")
  return day + "T" + part(date.getHours()) + ":" + part(date.getMinutes())
}

/** 过去的触发合并为一条记录，有十二小时内的机会时补跑最近的一次。 */
export function dueTaskRun(
  task: ScheduledTask,
  now: number,
  handledLocallyThrough: string | null,
): { scheduledAt: string; missed: boolean } | null {
  const planned = task.nextRunAt
  if (!task.enabled || planned === null || Date.parse(planned) > now) return null
  const earliest = Date.parse(planned)
  const cutoff = now - catchupMs
  let latest = earliest >= cutoff ? planned : null
  let after = Math.max(earliest, cutoff - 1)
  for (
    let time = nextTaskRun(task, after, handledLocallyThrough);
    time !== null;
    time = nextTaskRun(task, after, handledLocallyThrough)
  ) {
    const stamp = Date.parse(time)
    if (stamp > now || stamp <= after) break
    latest = time
    after = stamp
  }
  return { scheduledAt: latest ?? planned, missed: latest === null }
}

/** 检查墙钟是否较单调时钟跳变超过两分钟。 */
export function wallClockJumped(
  previous: { wall: number; elapsed: number } | null,
  current: { wall: number; elapsed: number },
): boolean {
  return (
    previous !== null &&
    Math.abs(current.wall - previous.wall - (current.elapsed - previous.elapsed)) >
      2 * scheduledTaskPollMs
  )
}
