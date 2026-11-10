// 观察受管浏览器进程的启动和退出，所有等待以该子进程为准。

import type { ChildProcess } from "node:child_process"

/** 本次进程状态与专用关闭能力，不能替换为同账号后续启动的进程。 */
export type ManagedProcess = {
  requestClose?: () => boolean
  child: ChildProcess
  exited: boolean
  waiters: Set<() => void>
}

/** 等待本次子进程的 spawn 或 error，不根据文件存在猜测进程已启动。 */
export function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onSpawn = (): void => {
      child.off("error", onError)
      resolve()
    }
    const onError = (): void => {
      child.off("spawn", onSpawn)
      reject(new Error("spawn failed"))
    }
    child.once("spawn", onSpawn)
    child.once("error", onError)
  })
}

function hasExitStatus(child: ChildProcess): boolean {
  return typeof child.exitCode === "number" || typeof child.signalCode === "string"
}

/** 观察本次进程实际退出，完成所有等待者并通知启动器移除所有权。 */
export function observeExit(
  child: ChildProcess,
  onExit: (process: ManagedProcess) => void,
): ManagedProcess {
  const managed: ManagedProcess = { child, exited: false, waiters: new Set() }
  const finish = (): void => {
    if (managed.exited) return
    managed.exited = true
    for (const waiter of managed.waiters) waiter()
    managed.waiters.clear()
    onExit(managed)
  }
  child.once("exit", finish)
  if (hasExitStatus(child)) {
    child.off("exit", finish)
    finish()
  }
  return managed
}

/** 只在本次受管进程实际退出后完成。 */
export function waitForExit(managed: ManagedProcess): Promise<void> {
  if (managed.exited) return Promise.resolve()
  return new Promise((resolve) => managed.waiters.add(resolve))
}

/** 有界等待真实退出，超时仅报告未确认，不释放进程所有权。 */
export function waitUntilExit(managed: ManagedProcess, timeoutMs: number): Promise<boolean> {
  if (managed.exited) return Promise.resolve(true)
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timeout)
      managed.waiters.delete(finish)
      resolve(true)
    }
    const timeout = setTimeout(() => {
      managed.waiters.delete(finish)
      resolve(false)
    }, timeoutMs)
    managed.waiters.add(finish)
  })
}
