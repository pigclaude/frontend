// 负责验证登录 shell PATH 的读取：什么时候读、从带噪声的输出里取出 PATH、超时和失败时沿用原值。
// 用假的 shell 脚本真的启动进程，和应用里一样。
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { applyLoginShellPath, needsLoginShellPath, readLoginShellPath } from "./login-shell-path"

const dirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pigclaude-login-shell-"))
  dirs.push(dir)
  return dir
}

/** 写一个可执行的假 shell：先跑 rc，再执行 `-i -l -c` 后面的命令。 */
function fakeShell(rc: string): string {
  const path = join(tempDir(), "fake-shell")
  writeFileSync(path, `#!/bin/sh\n${rc}\neval "$4"\n`)
  chmodSync(path, 0o755)
  return path
}

describe("needsLoginShellPath", () => {
  it("reads only for a graphical launch outside Windows", () => {
    expect(needsLoginShellPath({}, "darwin")).toBe(true)
    expect(needsLoginShellPath({}, "linux")).toBe(true)
    expect(needsLoginShellPath({ TERM: "linux" }, "linux")).toBe(true)
    expect(needsLoginShellPath({ TERM: "xterm-256color" }, "darwin")).toBe(false)
    expect(needsLoginShellPath({ TERM: "dumb" }, "linux")).toBe(false)
    expect(needsLoginShellPath({}, "win32")).toBe(false)
  })
})

describe.skipIf(process.platform === "win32")("readLoginShellPath", () => {
  it("returns the PATH the rc files set, whatever else they print", async () => {
    const shell = fakeShell(`echo "welcome back, PATH=/not/this"
printf 'no newline at the end'
export PATH="/opt/fake/bin:/usr/bin:/bin"
export ANTHROPIC_API_KEY="from-rc"`)

    await expect(readLoginShellPath(shell)).resolves.toBe("/opt/fake/bin:/usr/bin:/bin")
  })

  it("gives up when the shell fails, prints no PATH or cannot start", async () => {
    await expect(readLoginShellPath(fakeShell("exit 1"))).resolves.toBeNull()
    await expect(readLoginShellPath(fakeShell("unset PATH"))).resolves.toBeNull()
    await expect(readLoginShellPath(fakeShell("echo no env; exit 0"))).resolves.toBeNull()
    await expect(readLoginShellPath("/nonexistent/shell")).resolves.toBeNull()
    await expect(readLoginShellPath(join(fakeShell(""), "not-a-dir"))).resolves.toBeNull()
  })

  it("stops waiting for a shell that hangs and ends it", async () => {
    const pidFile = join(tempDir(), "pid")
    const shell = fakeShell(`echo $$ > "${pidFile}"\nsleep 30`)

    await expect(readLoginShellPath(shell, 1_500)).resolves.toBeNull()
    // 机器很忙时 shell 可能在写 pid 之前就被结束了，那样也没有进程留下。
    if (!existsSync(pidFile)) return
    const pid = Number(readFileSync(pidFile, "utf8"))
    await expect.poll(() => isRunning(pid), { timeout: 3_000 }).toBe(false)
  })

  it("does not wait for a background process the rc files started", async () => {
    const pidFile = join(tempDir(), "pid")
    const shell = fakeShell(`sleep 20 &\necho $! > "${pidFile}"\nexport PATH="/from/rc:$PATH"`)
    const started = Date.now()

    await expect(readLoginShellPath(shell, 4_000)).resolves.toMatch(/^\/from\/rc:/)
    expect(Date.now() - started).toBeLessThan(3_000)
    const pid = Number(readFileSync(pidFile, "utf8"))
    expect(isRunning(pid)).toBe(true)
    process.kill(pid)
  })
})

describe.skipIf(process.platform === "win32")("applyLoginShellPath", () => {
  it("merges only PATH, putting the login shell's directories first", async () => {
    const shell = fakeShell(`export PATH="/opt/fake/bin:/usr/bin:/bin"
export ANTHROPIC_API_KEY="from-rc"
export HTTPS_PROXY="http://user:secret@proxy.example"`)
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", SHELL: shell }

    await applyLoginShellPath(env, "darwin")

    expect(env).toEqual({ PATH: "/opt/fake/bin:/usr/bin:/bin:/usr/sbin:/sbin", SHELL: shell })
  })

  it("does not run the shell when launched from a terminal", async () => {
    const ranFile = join(tempDir(), "ran")
    const shell = fakeShell(`touch "${ranFile}"\nexport PATH="/opt/fake/bin"`)
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", SHELL: shell, TERM: "xterm" }

    await applyLoginShellPath(env, "linux")

    expect(env.PATH).toBe("/usr/bin:/bin")
    expect(existsSync(ranFile)).toBe(false)
  })

  it("keeps the current PATH when the login shell fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", SHELL: fakeShell("exit 1") }

    await applyLoginShellPath(env, "linux")

    expect(env).toEqual({ PATH: "/usr/bin:/bin", SHELL: env.SHELL })
    expect(warn).toHaveBeenCalledWith("LOGIN_SHELL_PATH_UNAVAILABLE")
  })
})

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
