// 负责验证 Claude CLI Keychain 读取的 service 命名、命令边界、错误映射、白名单和过期检查。

import { describe, expect, it } from "vitest"
import {
  claudeCliKeychainService,
  readClaudeCliCredential,
  type ClaudeCliCredentialReaderOptions,
  type ClaudeCliExecFile,
  type ClaudeCliExecFileOptions,
} from "./cli-credential-reader"
import { ClaudeAccountError } from "./errors"

const now = Date.parse("2026-10-26T00:00:00.000Z")
const accessToken = "sk-ant-oat-access-secret"
const refreshToken = "sk-ant-ort-refresh-secret"
const stderrSecret = "security: secret diagnostic"
const future = now + 60 * 60 * 1_000

type ExecCall = {
  file: string
  args: string[]
  options: ClaudeCliExecFileOptions
}

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken,
      refreshToken,
      expiresAt: future,
      refreshTokenExpiresAt: now + 30 * 24 * 60 * 60 * 1_000,
      scopes: ["user:inference", "user:profile"],
      subscriptionType: "max",
      rateLimitTier: "default_claude_max_20x",
      ...overrides,
    },
  })
}

function fakeExec(
  stdout: string,
  error: Error | null = null,
  stderr = "",
): { execFile: ClaudeCliExecFile; calls: ExecCall[] } {
  const calls: ExecCall[] = []
  const execFile: ClaudeCliExecFile = (file, args, options, callback) => {
    calls.push({ file, args, options })
    callback(error, stdout, stderr)
  }
  return { execFile, calls }
}

function exitError(code: number): Error {
  const error = new Error(stderrSecret)
  Object.assign(error, { code, stdout: accessToken, stderr: stderrSecret })
  return error
}

function read(options: Partial<ClaudeCliCredentialReaderOptions> = {}) {
  return readClaudeCliCredential({
    platform: "darwin",
    user: "tester",
    env: {},
    now: () => now,
    ...options,
  })
}

async function readError(execFile: ClaudeCliExecFile): Promise<ClaudeAccountError> {
  try {
    await read({ execFile })
  } catch (error) {
    expect(error).toBeInstanceOf(ClaudeAccountError)
    return error as ClaudeAccountError
  }
  throw new Error("expected readClaudeCliCredential to reject")
}

function expectNoLeak(error: ClaudeAccountError): void {
  const serialized = [
    error.name,
    error.code,
    error.message,
    error.stack ?? "",
    JSON.stringify(error),
  ].join("\n")
  expect(serialized).not.toContain(accessToken)
  expect(serialized).not.toContain(refreshToken)
  expect(serialized).not.toContain(stderrSecret)
  expect(error).not.toHaveProperty("stdout")
  expect(error).not.toHaveProperty("stderr")
  expect(error).not.toHaveProperty("cause")
}

describe("claudeCliKeychainService", () => {
  it("uses the unsuffixed service without a config dir", () => {
    expect(claudeCliKeychainService()).toBe("Claude Code-credentials")
    expect(claudeCliKeychainService(null)).toBe("Claude Code-credentials")
    expect(claudeCliKeychainService("")).toBe("Claude Code-credentials")
  })

  it("derives an eight-character hash suffix from the NFC config dir", () => {
    expect(claudeCliKeychainService("/Users/me/.claude-work")).toBe(
      "Claude Code-credentials-1e91dd84",
    )
    expect(claudeCliKeychainService("e\u0301")).toBe(claudeCliKeychainService("\u00e9"))
  })
})

describe("readClaudeCliCredential", () => {
  it("reads the default keychain item with a bounded security command", async () => {
    const { execFile, calls } = fakeExec(payload())
    const credential = await read({ execFile })
    expect(calls).toEqual([
      {
        file: "/usr/bin/security",
        args: ["find-generic-password", "-a", "tester", "-w", "-s", "Claude Code-credentials"],
        options: {
          encoding: "utf8",
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
          shell: false,
        },
      },
    ])
    expect(credential).toEqual({
      accessToken,
      refreshToken,
      expiresAt: future,
      refreshTokenExpiresAt: now + 30 * 24 * 60 * 60 * 1_000,
      scopes: ["user:inference", "user:profile"],
      subscriptionType: "max",
      rateLimitTier: "default_claude_max_20x",
    })
  })

  it("reads the hashed service for CLAUDE_CONFIG_DIR and lets an explicit config dir win", async () => {
    const fromEnv = fakeExec(payload())
    await read({ execFile: fromEnv.execFile, env: { CLAUDE_CONFIG_DIR: "/Users/me/.claude-work" } })
    expect(fromEnv.calls[0]?.args).toContain("Claude Code-credentials-1e91dd84")

    const explicit = fakeExec(payload())
    await read({
      execFile: explicit.execFile,
      env: { CLAUDE_CONFIG_DIR: "/Users/me/.claude-work" },
      configDir: "/tmp/claude-config",
    })
    expect(explicit.calls[0]?.args).toContain("Claude Code-credentials-19aa18c8")

    const forcedDefault = fakeExec(payload())
    await read({
      execFile: forcedDefault.execFile,
      env: { CLAUDE_CONFIG_DIR: "/Users/me/.claude-work" },
      configDir: null,
    })
    expect(forcedDefault.calls[0]?.args).toContain("Claude Code-credentials")
  })

  it("treats a whitespace-only config dir as absent", async () => {
    const { execFile, calls } = fakeExec(payload())
    await read({ execFile, env: { CLAUDE_CONFIG_DIR: "   " } })
    expect(calls[0]?.args).toContain("Claude Code-credentials")
  })

  it("falls back to USER when no user is injected", async () => {
    const { execFile, calls } = fakeExec(payload())
    await read({ execFile, user: "", env: { USER: "env-user" } })
    expect(calls[0]?.args).toContain("env-user")
  })

  it("replaces a user name Claude Code would reject with the fixed fallback", async () => {
    for (const user of ["tester name", "tester;rm", "用户", "/Users/me"]) {
      const { execFile, calls } = fakeExec(payload())
      await read({ execFile, user })
      expect(calls[0]?.args, user).toContain("claude-code-user")
    }

    const fromEnv = fakeExec(payload())
    await read({ execFile: fromEnv.execFile, user: "", env: { USER: "bad/user" } })
    expect(fromEnv.calls[0]?.args).toContain("claude-code-user")
  })

  it("returns only the claudeAiOauth whitelist", async () => {
    const stdout = JSON.stringify({
      mcpOAuth: { token: accessToken },
      extra: accessToken,
      claudeAiOauth: {
        accessToken,
        refreshToken,
        expiresAt: future,
        scopes: [],
        subscriptionType: null,
        rateLimitTier: null,
        mcpOAuth: { token: refreshToken },
        unknown: accessToken,
      },
    })
    const credential = await read({ execFile: fakeExec(stdout).execFile })
    expect(Object.keys(credential).sort()).toEqual([
      "accessToken",
      "expiresAt",
      "rateLimitTier",
      "refreshToken",
      "refreshTokenExpiresAt",
      "scopes",
      "subscriptionType",
    ])
    expect(credential).not.toHaveProperty("mcpOAuth")
    expect(credential).not.toHaveProperty("extra")
    expect(credential).not.toHaveProperty("unknown")
    expect(credential.refreshTokenExpiresAt).toBeNull()
    expect(credential.subscriptionType).toBeNull()
    expect(credential.rateLimitTier).toBeNull()
  })

  it("maps a missing keychain item to CLI_CREDENTIAL_NOT_FOUND", async () => {
    const error = await readError(fakeExec(accessToken, exitError(44), stderrSecret).execFile)
    expect(error.code).toBe("CLI_CREDENTIAL_NOT_FOUND")
    expect(error.message).toBe("未找到 Claude CLI 凭据，请先在 Claude CLI 中登录")
    expectNoLeak(error)
  })

  it("maps a locked keychain to CLI_KEYCHAIN_LOCKED", async () => {
    const error = await readError(fakeExec(accessToken, exitError(36), stderrSecret).execFile)
    expect(error.code).toBe("CLI_KEYCHAIN_LOCKED")
    expect(error.message).toBe("钥匙串已锁定，请解锁后重试")
    expectNoLeak(error)
  })

  it("maps any other security failure to CLI_KEYCHAIN_DENIED", async () => {
    for (const code of [1, 51, 128]) {
      const error = await readError(fakeExec(accessToken, exitError(code), stderrSecret).execFile)
      expect(error.code).toBe("CLI_KEYCHAIN_DENIED")
      expect(error.message).toBe("无法读取 Claude CLI 凭据，请允许访问钥匙串后重试")
      expectNoLeak(error)
    }
  })

  it("maps a timeout to a retry message instead of a plain denial", async () => {
    for (const failure of [
      { code: null, killed: true, signal: "SIGTERM" },
      { code: "ETIMEDOUT" },
    ]) {
      const timedOut = new Error(stderrSecret)
      Object.assign(timedOut, failure)
      const error = await readError(fakeExec(accessToken, timedOut, stderrSecret).execFile)
      expect(error.code).toBe("CLI_KEYCHAIN_DENIED")
      expect(error.message).toBe("读取钥匙串超时，请重试并允许访问")
      expectNoLeak(error)
    }
  })

  it("maps a maxBuffer overflow to a fixed credential error without leaking output", async () => {
    const overflow = new Error(stderrSecret)
    Object.assign(overflow, { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true })
    const error = await readError(fakeExec(accessToken, overflow, stderrSecret).execFile)
    expect(error.code).toBe("CLI_CREDENTIAL_INVALID")
    expect(error.message).toBe("Claude CLI 凭据过大，无法读取")
    expectNoLeak(error)
  })

  it("maps a synchronous execFile failure to CLI_KEYCHAIN_DENIED", async () => {
    const execFile: ClaudeCliExecFile = () => {
      throw new Error(stderrSecret)
    }
    const error = await readError(execFile)
    expect(error.code).toBe("CLI_KEYCHAIN_DENIED")
    expectNoLeak(error)
  })

  it("rejects malformed JSON without leaking the keychain output", async () => {
    const error = await readError(fakeExec(`not-json ${accessToken}`, null, stderrSecret).execFile)
    expect(error.code).toBe("CLI_CREDENTIAL_INVALID")
    expect(error.message).toBe("Claude CLI 凭据格式无效")
    expectNoLeak(error)
  })

  it("rejects a payload with only mcpOAuth", async () => {
    const stdout = JSON.stringify({ mcpOAuth: { token: accessToken, refreshToken } })
    const error = await readError(fakeExec(stdout, null, stderrSecret).execFile)
    expect(error.code).toBe("CLI_CREDENTIAL_INVALID")
    expectNoLeak(error)
  })

  it("rejects missing access or refresh tokens", async () => {
    for (const overrides of [
      { accessToken: "" },
      { accessToken: undefined },
      { refreshToken: "" },
      { refreshToken: undefined },
    ]) {
      const error = await readError(fakeExec(payload(overrides)).execFile)
      expect(error.code).toBe("CLI_CREDENTIAL_INVALID")
      expectNoLeak(error)
    }
  })

  it("rejects an invalid expiresAt or scopes", async () => {
    for (const overrides of [
      { expiresAt: "later" },
      { expiresAt: Number.POSITIVE_INFINITY },
      { scopes: "user:inference" },
      { scopes: ["user:inference", 1] },
      { refreshTokenExpiresAt: "later" },
      { subscriptionType: 1 },
      { rateLimitTier: false },
    ]) {
      const error = await readError(fakeExec(payload(overrides)).execFile)
      expect(error.code).toBe("CLI_CREDENTIAL_INVALID")
      expectNoLeak(error)
    }
  })

  it("rejects an expired refresh token", async () => {
    const error = await readError(fakeExec(payload({ refreshTokenExpiresAt: now - 1 })).execFile)
    expect(error.code).toBe("CLI_CREDENTIAL_EXPIRED")
    expect(error.message).toBe("Claude CLI 凭据已过期，请先在 Claude CLI 中刷新")
    expectNoLeak(error)
  })

  it("rejects an expired access token", async () => {
    for (const expiresAt of [now - 1, now]) {
      const error = await readError(fakeExec(payload({ expiresAt })).execFile)
      expect(error.code).toBe("CLI_CREDENTIAL_EXPIRED")
      expectNoLeak(error)
    }
  })

  it("rejects non-macOS platforms before touching the keychain", async () => {
    for (const platform of ["win32", "linux", "freebsd"]) {
      const { execFile, calls } = fakeExec(payload())
      await expect(read({ platform, execFile })).rejects.toMatchObject({
        code: "CLI_IMPORT_UNSUPPORTED_PLATFORM",
      })
      expect(calls).toEqual([])
    }
  })
})
