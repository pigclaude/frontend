// 负责以真实 Node 子进程回归冷启动清理故障，不启动安装 Electron 或操作真实协议。
import { test, expect } from "@playwright/test"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  findOwnedProcessIds,
  OwnedProcess,
  cleanupOwnedProcesses,
  cleanupFailedLaunch,
  removeProfileWhenStopped,
} from "./phase1-owned-process"

async function startChild(marker: string, ignoreTerm = false): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `${ignoreTerm ? 'process.on("SIGTERM",()=>{});' : ""}process.send("ready");setInterval(()=>{},1000)`,
      "--",
      marker,
    ],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
  )
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject)
    child.once("message", () => resolve())
  })
  return child
}

function alive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

async function closeChild(child: ChildProcess): Promise<void> {
  if (!alive(child)) return
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
    child.kill("SIGKILL")
  })
}

test("PID 登记前业务失败仍回收真实 owner 进程，同 executable 旁观实例不受影响", async () => {
  const owner = new OwnedProcess(process.execPath, { timeoutMs: 150 })
  owner.beginLaunch()
  const child = await startChild(owner.marker)
  const bystander = await startChild("unrelated-instance")
  const profile = await mkdtemp(join(tmpdir(), "pigclaude-confirmed-owner-"))
  await writeFile(join(profile, "profile-marker"), "removed-after-exit")
  try {
    expect(await owner.cleanup()).toBe(true)
    await expect.poll(() => alive(child)).toBe(false)
    expect(alive(bystander)).toBe(true)
    expect(await removeProfileWhenStopped(profile, owner.cleanupConfirmed)).toBe(true)
    await expect(readFile(join(profile, "profile-marker"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
  } finally {
    await closeChild(child)
    await closeChild(bystander)
    await rm(profile, { recursive: true, force: true })
  }
})

test("PID 探测瞬时失败后 cleanup 独立重新发现本次进程", async () => {
  let first = true
  const owner = new OwnedProcess(process.execPath, {
    timeoutMs: 150,
    probe: async (executable, marker) => {
      if (first) {
        first = false
        throw new Error("injected ps failure")
      }
      return findOwnedProcessIds(executable, marker)
    },
  })
  owner.beginLaunch()
  const child = await startChild(owner.marker)
  try {
    await expect(owner.capture()).rejects.toThrow("injected ps failure")
    expect(await owner.cleanup()).toBe(true)
    await expect.poll(() => alive(child)).toBe(false)
  } finally {
    await closeChild(child)
  }
})

test("真实 owner 忽略 SIGTERM 时只升级该 PID，旁观实例继续存活", async () => {
  const owner = new OwnedProcess(process.execPath, { timeoutMs: 150 })
  owner.beginLaunch()
  const child = await startChild(owner.marker, true)
  const bystander = await startChild("unrelated-term-resistant", true)
  try {
    expect(await owner.capture()).toContain(child.pid)
    expect(await owner.cleanup()).toBe(true)
    await expect.poll(() => alive(child)).toBe(false)
    expect(child.signalCode).toBe("SIGKILL")
    expect(alive(bystander)).toBe(true)
  } finally {
    await closeChild(child)
    await closeChild(bystander)
  }
})

test("持续探测失败保留真实 profile 且不声称清理成功", async () => {
  const owner = new OwnedProcess(process.execPath, {
    timeoutMs: 60,
    probe: async () => {
      throw new Error("injected persistent ps failure")
    },
  })
  const profile = await mkdtemp(join(tmpdir(), "pigclaude-owned-process-"))
  await writeFile(join(profile, "profile-marker"), "retained")
  owner.beginLaunch()
  const child = await startChild(owner.marker)
  try {
    expect(await owner.cleanup()).toBe(false)
    expect(owner.cleanupConfirmed).toBe(false)
    expect(await removeProfileWhenStopped(profile, owner.cleanupConfirmed)).toBe(false)
    expect(await readFile(join(profile, "profile-marker"), "utf8")).toBe("retained")
    expect(alive(child)).toBe(true)
  } finally {
    await closeChild(child)
    await rm(profile, { recursive: true, force: true })
  }
})

test("登记过 PID 后持续探测失败也不能确认退出或删除 profile", async () => {
  let unavailable = false
  const owner = new OwnedProcess(process.execPath, {
    timeoutMs: 60,
    probe: async (executable, marker) => {
      if (unavailable) throw new Error("injected later ps failure")
      return findOwnedProcessIds(executable, marker)
    },
  })
  owner.beginLaunch()
  const child = await startChild(owner.marker)
  const profile = await mkdtemp(join(tmpdir(), "pigclaude-known-owner-"))
  await writeFile(join(profile, "profile-marker"), "retained")
  try {
    expect(await owner.capture()).toContain(child.pid)
    unavailable = true
    expect(await owner.cleanup()).toBe(false)
    expect(await removeProfileWhenStopped(profile, owner.cleanupConfirmed)).toBe(false)
    expect(await readFile(join(profile, "profile-marker"), "utf8")).toBe("retained")
    expect(alive(child)).toBe(true)
  } finally {
    await closeChild(child)
    await rm(profile, { recursive: true, force: true })
  }
})

test("OS open 已尝试但未确证任何 owner 时保守保留 profile", async () => {
  const owner = new OwnedProcess(process.execPath, { timeoutMs: 60 })
  const profile = await mkdtemp(join(tmpdir(), "pigclaude-unconfirmed-owner-"))
  await writeFile(join(profile, "profile-marker"), "retained")
  owner.beginLaunch()
  try {
    expect(await owner.cleanup()).toBe(false)
    expect(await removeProfileWhenStopped(profile, owner.cleanupConfirmed)).toBe(false)
    expect(await readFile(join(profile, "profile-marker"), "utf8")).toBe("retained")
  } finally {
    await rm(profile, { recursive: true, force: true })
  }
})

test("窗口创建及 close 失败前登记的 owner 仍由外层 registry 确认退出", async () => {
  const owner = new OwnedProcess(process.execPath, { timeoutMs: 150 })
  const registry = new Set([owner])
  owner.beginLaunch()
  const child = await startChild(owner.marker, true)
  const bystander = await startChild("unregistered-user-instance", true)
  try {
    expect(await owner.capture()).toContain(child.pid)
    expect(
      await cleanupFailedLaunch(owner, async () => {
        throw new Error("injected close failure before desktop registration")
      }),
    ).toBe(true)
    expect(await cleanupOwnedProcesses(registry)).toBe(true)
    await expect.poll(() => alive(child)).toBe(false)
    expect(child.signalCode).toBe("SIGKILL")
    expect(alive(bystander)).toBe(true)
  } finally {
    await closeChild(child)
    await closeChild(bystander)
  }
})
