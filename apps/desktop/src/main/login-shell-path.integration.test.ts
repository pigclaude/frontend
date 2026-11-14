// 负责验证登录 shell 的 PATH 经应用环境进入会话进程和工作台终端，登录 shell 的其他变量都不进入。
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { applyLoginShellPath } from "./login-shell-path"
import { SessionEnvironment } from "./session/session-environment"
import { workbenchChildEnv } from "./workbench/child-env"

const dirs: string[] = []
const hostNames = ["PATH", "SHELL", "TERM"] as const
const savedHost = Object.fromEntries(hostNames.map((name) => [name, process.env[name]]))

afterEach(() => {
  for (const name of hostNames) {
    const value = savedHost[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pigclaude-login-shell-env-"))
  dirs.push(dir)
  return dir
}

describe.skipIf(process.platform === "win32")("login shell PATH in child environments", () => {
  it("gives the session and the terminal the merged PATH and nothing else from the shell", async () => {
    const shell = join(tempDir(), "fake-shell")
    writeFileSync(
      shell,
      `#!/bin/sh
export PATH="/opt/login/bin:$PATH"
export ANTHROPIC_API_KEY="key-from-rc"
export HTTPS_PROXY="http://user:secret-from-rc@proxy.example"
export FROM_LOGIN_SHELL="yes"
eval "$4"
`,
    )
    chmodSync(shell, 0o755)
    process.env.PATH = "/usr/bin:/bin:/usr/sbin"
    process.env.SHELL = shell
    delete process.env.TERM

    await applyLoginShellPath(process.env, "darwin")
    const session = await SessionEnvironment.create({
      sessionId: "login-shell-path",
      workspace: "/tmp/workspace",
      daemonBaseUrl: "http://127.0.0.1:47821",
      sessionToken: "session-token",
      timezone: "Asia/Shanghai",
      locale: "zh-CN",
      binaryPath: "/opt/claude/bin/claude",
      userDataPath: tempDir(),
    })
    const terminal = workbenchChildEnv()

    expect(session.env.PATH).toBe("/opt/login/bin:/usr/bin:/bin:/usr/sbin")
    expect(terminal.PATH).toBe("/opt/login/bin:/usr/bin:/bin:/usr/sbin")
    for (const env of [session.env, terminal]) {
      expect(env.FROM_LOGIN_SHELL).toBeUndefined()
      expect(JSON.stringify(env)).not.toContain("key-from-rc")
      expect(JSON.stringify(env)).not.toContain("secret-from-rc")
    }
    await session.cleanup()
  })
})
