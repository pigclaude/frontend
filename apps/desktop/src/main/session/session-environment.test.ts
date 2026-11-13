// 负责验证会话环境的变量、隔离目录、Intl 预加载、权限和清理，并确认用户设置与真实凭据不会进入环境。

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  cleanupStaleSessionDirs,
  SessionEnvironment,
  placeholderOAuthToken,
} from "./session-environment"
import { systemLocale, systemTimezone } from "./session-locale"

const temporaryDirs: string[] = []
const originalHome = process.env.HOME

afterEach(async () => {
  process.env.HOME = originalHome
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.HTTP_PROXY
  delete process.env.HTTPS_PROXY
  delete process.env.ALL_PROXY
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionEnvironment", () => {
  it.skipIf(process.platform === "win32")(
    "不能保留指定脚本时拒绝启动且不创建配置目录",
    async () => {
      const userDataPath = await tempDir()
      await expect(
        SessionEnvironment.create({
          sessionId: "unsupported-script",
          workspace: "/tmp/workspace",
          daemonBaseUrl: "http://127.0.0.1:47821",
          sessionToken: "synthetic-unsupported-script",
          timezone: "UTC",
          locale: "zh-Hant-CN",
          binaryPath: "/synthetic/claude",
          userDataPath,
        }),
      ).rejects.toThrow("语言脚本")
      await expect(stat(join(userDataPath, "sessions"))).rejects.toMatchObject({ code: "ENOENT" })
    },
  )

  it.each([
    ["zh-Hans-CN", "zh_CN.UTF-8"],
    ["sr-Latn-RS", "sr_RS.UTF-8@latin"],
  ])("把脚本语言 %s 转为系统接受的 locale", async (locale, expected) => {
    const userDataPath = await tempDir()
    const environment = await SessionEnvironment.create({
      sessionId: "script-locale",
      workspace: "/tmp/workspace",
      daemonBaseUrl: "http://127.0.0.1:47821",
      sessionToken: "synthetic-script-locale",
      timezone: "UTC",
      locale,
      binaryPath: "/synthetic/claude",
      userDataPath,
    })
    expect(environment.env.LANG).toBe(process.platform === "win32" ? locale : expected)
    expect(environment.env.LC_ALL).toBe(environment.env.LANG)
    await environment.cleanup()
  })

  it("builds the isolated session environment from the design table", async () => {
    const userDataPath = await tempDir()
    const environment = await SessionEnvironment.create({
      sessionId: "session-1",
      workspace: "/tmp/workspace",
      daemonBaseUrl: "http://127.0.0.1:47821",
      sessionToken: "session-token-abc",
      timezone: "America/Los_Angeles",
      locale: "en-US",
      binaryPath: "/opt/claude/bin/claude",
      userDataPath,
    })

    const sessionDir = join(userDataPath, "sessions", "session-1")
    const configDir = join(sessionDir, "claude")
    const preloadPath = join(sessionDir, "intl-preload.cjs")

    expect(environment.sessionDir).toBe(sessionDir)
    expect(environment.configDir).toBe(configDir)
    expect(environment.env).toMatchObject({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:47821",
      CLAUDE_CODE_OAUTH_TOKEN: placeholderOAuthToken,
      CLAUDE_CONFIG_DIR: configDir,
      TZ: "America/Los_Angeles",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      NODE_OPTIONS: `--require ${JSON.stringify(preloadPath)}`,
      ANTHROPIC_CUSTOM_HEADERS: "x-pigclaude-session: session-token-abc",
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    })
    expect(placeholderOAuthToken).toBe("pigclaude-local")
    expect(environment.binaryPath).toBe("/opt/claude/bin/claude")
    expect(environment.timezone).toBe("America/Los_Angeles")
    expect(environment.env.TZ).toBe("America/Los_Angeles")
    expect(environment.env.LANG).toBe("en_US.UTF-8")
    expect(environment.env.NODE_OPTIONS).toContain(environment.sessionDir)
    expect(environment.env.NODE_OPTIONS).toContain("intl-preload.cjs")

    expect((await stat(sessionDir)).isDirectory()).toBe(true)
    expect((await stat(configDir)).isDirectory()).toBe(true)
    expect(await fileMode(sessionDir)).toBe(0o700)
    expect(await fileMode(configDir)).toBe(0o700)
    expect(await fileMode(preloadPath)).toBe(0o700)
    expect(await readFile(preloadPath, "utf8")).toContain("America/Los_Angeles")
    // 普通会话不写账号配置，模型探测才会写。
    await expect(stat(join(configDir, ".claude.json"))).rejects.toMatchObject({ code: "ENOENT" })

    await environment.cleanup()
  })

  it("uses the real account token and org config for a model probe", async () => {
    const userDataPath = await tempDir()
    const modelAuth = {
      accessToken: "real-account-token",
      accountUuid: "account-uuid",
      email: "model@example.test",
      organizationUuid: "organization-uuid",
    }
    const environment = await SessionEnvironment.create({
      sessionId: "model-probe",
      workspace: "/tmp/workspace",
      daemonBaseUrl: "http://127.0.0.1:47821",
      sessionToken: "model-probe-token",
      timezone: "UTC",
      locale: "en-US",
      binaryPath: "/opt/claude/bin/claude",
      userDataPath,
      modelAuth,
    })

    expect(environment.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("real-account-token")
    expect(environment.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(environment.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
    const configPath = join(environment.configDir, ".claude.json")
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      oauthAccount: {
        accountUuid: "account-uuid",
        emailAddress: "model@example.test",
        organizationUuid: "organization-uuid",
      },
    })
    expect(await fileMode(configPath)).toBe(0o600)

    await environment.cleanup()
  })

  it("替换 daemon 地址和占位 token 为开发期供应商", async () => {
    const userDataPath = await tempDir()
    const environment = await SessionEnvironment.create({
      sessionId: "provider-session",
      workspace: "/tmp/workspace",
      daemonBaseUrl: "http://127.0.0.1:47821",
      sessionToken: "session-token-abc",
      timezone: "UTC",
      locale: "en-US",
      binaryPath: "/opt/claude/bin/claude",
      userDataPath,
      provider: { baseUrl: "https://provider.example.test", authToken: "provider-token-xyz" },
    })

    expect(environment.env.ANTHROPIC_BASE_URL).toBe("https://provider.example.test")
    expect(environment.env.ANTHROPIC_AUTH_TOKEN).toBe("provider-token-xyz")
    expect(environment.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(environment.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
    await environment.cleanup()
  })

  it("供应商覆盖下不写模型查询账号配置", async () => {
    const userDataPath = await tempDir()
    const environment = await SessionEnvironment.create({
      sessionId: "provider-model-probe",
      workspace: "/tmp/workspace",
      daemonBaseUrl: "http://127.0.0.1:47821",
      sessionToken: "provider-model-probe-token",
      timezone: "UTC",
      locale: "en-US",
      binaryPath: "/opt/claude/bin/claude",
      userDataPath,
      provider: { baseUrl: "https://provider.example.test", authToken: "provider-token-xyz" },
      modelAuth: {
        accessToken: "real-account-token",
        accountUuid: "account-uuid",
        email: "model@example.test",
        organizationUuid: "organization-uuid",
      },
    })

    expect(environment.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    await expect(stat(join(environment.configDir, ".claude.json"))).rejects.toMatchObject({
      code: "ENOENT",
    })
    await environment.cleanup()
  })

  it.each([
    ["empty", "", "", systemTimezone(), systemLocale()],
    ["system", "system", "", systemTimezone(), systemLocale()],
    ["explicit", "Asia/Tokyo", "ja-JP", "Asia/Tokyo", "ja-JP"],
  ])(
    "never puts a %s locale or timezone into TZ, LANG or the preload",
    async (label, timezone, locale, expectedTimezone, expectedLocale) => {
      const userDataPath = await tempDir()
      const environment = await SessionEnvironment.create({
        sessionId: `session-locale-${label}`,
        workspace: "/tmp/workspace",
        daemonBaseUrl: "http://127.0.0.1:47825",
        sessionToken: "session-token-locale",
        timezone,
        locale,
        binaryPath: "/opt/claude/bin/claude",
        userDataPath,
      })

      expect(environment.timezone).toBe(expectedTimezone)
      expect(environment.env.TZ).toBe(expectedTimezone)
      expect(environment.env.LANG?.replace(/\.UTF-8$/, "").replaceAll("_", "-")).toBe(
        expectedLocale,
      )
      const preload = await readFile(join(environment.sessionDir, "intl-preload.cjs"), "utf8")
      expect(preload).toContain(JSON.stringify(expectedTimezone))
      expect(environment.env.TZ).not.toBe("")
      expect(environment.env.LANG).not.toBe("")
      expect(environment.env.TZ?.toLowerCase()).not.toBe("system")

      await environment.cleanup()
    },
  )

  it("does not copy user settings, proxies or real credentials into the session", async () => {
    const userDataPath = await tempDir()
    const home = await tempDir()
    await mkdir(join(home, ".claude"), { recursive: true })
    await writeFile(
      join(home, ".claude", "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: "real-user-token",
          ANTHROPIC_API_KEY: "real-user-key",
          ANTHROPIC_BASE_URL: "https://evil.example",
          CLAUDE_CODE_OAUTH_TOKEN: "real-oauth-token",
          HTTP_PROXY: "http://user:proxy-password@proxy.example",
          HTTPS_PROXY: "http://user:proxy-password@proxy.example",
          ALL_PROXY: "socks5://proxy.example",
          CLAUDE_CODE_USE_BEDROCK: "1",
          CLAUDE_CODE_USE_VERTEX: "1",
          ANTHROPIC_CUSTOM_HEADERS: "X-User: secret",
        },
      }),
    )
    process.env.HOME = home
    process.env.ANTHROPIC_AUTH_TOKEN = "host-token"
    process.env.ANTHROPIC_API_KEY = "host-key"
    process.env.HTTP_PROXY = "http://host:proxy-password@proxy.example"
    process.env.HTTPS_PROXY = "http://host:proxy-password@proxy.example"
    process.env.ALL_PROXY = "socks5://host-proxy.example"

    const environment = await SessionEnvironment.create({
      sessionId: "session-2",
      workspace: "/tmp/workspace",
      daemonBaseUrl: "http://127.0.0.1:47822",
      sessionToken: "session-token-def",
      timezone: "Asia/Tokyo",
      locale: "ja-JP",
      binaryPath: "/opt/claude/bin/claude",
      userDataPath,
    })

    const serialized = JSON.stringify(environment.env)
    for (const key of [
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
    ]) {
      expect(environment.env[key]).toBeUndefined()
    }
    expect(environment.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:47822")
    expect(environment.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(placeholderOAuthToken)
    expect(environment.env.ANTHROPIC_CUSTOM_HEADERS).toBe("x-pigclaude-session: session-token-def")
    expect(environment.timezone).toBe("Asia/Tokyo")
    expect(environment.env.TZ).toBe("Asia/Tokyo")
    expect(environment.env.LANG).toBe("ja_JP.UTF-8")
    expect(serialized).not.toContain("real-user-token")
    expect(serialized).not.toContain("real-user-key")
    expect(serialized).not.toContain("real-oauth-token")
    expect(serialized).not.toContain("host-token")
    expect(serialized).not.toContain("proxy-password")
    expect(serialized).not.toContain("X-User")

    await environment.cleanup()
  })

  it("removes the whole session directory and is safe to clean twice", async () => {
    const userDataPath = await tempDir()
    const environment = await SessionEnvironment.create({
      sessionId: "session-3",
      workspace: "/tmp/workspace",
      daemonBaseUrl: "http://127.0.0.1:47823",
      sessionToken: "session-token-ghi",
      timezone: "Europe/Berlin",
      locale: "de-DE",
      binaryPath: "/opt/claude/bin/claude",
      userDataPath,
    })
    const preloadPath = join(environment.sessionDir, "intl-preload.cjs")

    await environment.cleanup()
    await environment.cleanup()

    await expect(stat(environment.sessionDir)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(stat(preloadPath)).rejects.toMatchObject({ code: "ENOENT" })
    expect((await stat(join(userDataPath, "sessions"))).isDirectory()).toBe(true)
  })

  it("removes stale session directories at startup but keeps the current session", async () => {
    const userDataPath = await tempDir()
    const sessionsDir = join(userDataPath, "sessions")
    const stale = join(sessionsDir, "stale-session")
    const active = join(sessionsDir, "active-session")
    await mkdir(stale, { recursive: true })
    await mkdir(active, { recursive: true })

    await cleanupStaleSessionDirs(userDataPath, ["active-session"])
    await expect(stat(stale)).rejects.toMatchObject({ code: "ENOENT" })
    expect((await stat(active)).isDirectory()).toBe(true)

    await cleanupStaleSessionDirs(userDataPath)
    await expect(stat(active)).rejects.toMatchObject({ code: "ENOENT" })
    expect((await stat(sessionsDir)).isDirectory()).toBe(true)
  })

  it("does nothing when the sessions directory does not exist", async () => {
    const userDataPath = await tempDir()

    await expect(cleanupStaleSessionDirs(userDataPath)).resolves.toBeUndefined()
  })

  it("rejects session ids and tokens that could escape the session directory or inject headers", async () => {
    const userDataPath = await tempDir()
    const base = {
      workspace: "/tmp/workspace",
      daemonBaseUrl: "http://127.0.0.1:47824",
      sessionToken: "session-token-jkl",
      timezone: "UTC",
      locale: "en-US",
      binaryPath: "/opt/claude/bin/claude",
      userDataPath,
    }

    await expect(SessionEnvironment.create({ ...base, sessionId: "../escape" })).rejects.toThrow(
      /session id/i,
    )
    await expect(
      SessionEnvironment.create({
        ...base,
        sessionId: "session-4",
        sessionToken: "a\r\nx-pigclaude-session: b",
      }),
    ).rejects.toThrow(/session token/i)
    await expect(stat(join(userDataPath, "sessions", "session-4"))).rejects.toMatchObject({
      code: "ENOENT",
    })
  })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-env-"))
  temporaryDirs.push(dir)
  return dir
}

function fileMode(path: string): Promise<number> {
  return stat(path).then((info) => info.mode & 0o777)
}
