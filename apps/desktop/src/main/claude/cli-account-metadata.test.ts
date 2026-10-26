// 负责验证 Claude CLI 元数据读取的路径选择、缺失/非法回退和 oauthAccount 白名单过滤。

import { describe, expect, it } from "vitest"
import {
  readClaudeCliAccountMetadata,
  type ClaudeCliAccountMetadataOptions,
} from "./cli-account-metadata"

const token = "sk-ant-oat-secret-token"

type FileReader = {
  readFile: (path: string) => Promise<string>
  paths: string[]
}

function fileReader(content: string | Error): FileReader {
  const paths: string[] = []
  return {
    paths,
    readFile: async (path) => {
      paths.push(path)
      if (content instanceof Error) throw content
      return content
    },
  }
}

function read(
  content: string | Error,
  options: Partial<ClaudeCliAccountMetadataOptions> = {},
): { result: Promise<Awaited<ReturnType<typeof readClaudeCliAccountMetadata>>>; paths: string[] } {
  const reader = fileReader(content)
  return {
    result: readClaudeCliAccountMetadata({ readFile: reader.readFile, ...options }),
    paths: reader.paths,
  }
}

describe("readClaudeCliAccountMetadata", () => {
  it("reads oauthAccount from the home config and drops unknown fields", async () => {
    const content = JSON.stringify({
      oauthAccount: {
        accountUuid: "account-uuid",
        emailAddress: "user@example.com",
        displayName: "工作账号",
        fullName: "Work Account",
        organizationUuid: "org-uuid",
        organizationName: "Example Org",
        organizationType: "claude_max",
        organizationRateLimitTier: "default_claude_max_20x",
        accessToken: token,
        unknown: token,
      },
      accessToken: token,
    })
    const { result, paths } = read(content, { homeDir: "/Users/tester" })
    expect(paths).toEqual(["/Users/tester/.claude.json"])
    const metadata = await result
    expect(metadata).toEqual({
      accountUuid: "account-uuid",
      emailAddress: "user@example.com",
      displayName: "工作账号",
      fullName: "Work Account",
      organizationUuid: "org-uuid",
      organizationName: "Example Org",
      organizationType: "claude_max",
      organizationRateLimitTier: "default_claude_max_20x",
    })
    expect(JSON.stringify(metadata)).not.toContain(token)
    expect(metadata).not.toHaveProperty("accessToken")
    expect(metadata).not.toHaveProperty("unknown")
  })

  it("prefers CLAUDE_CONFIG_DIR and lets an explicit config dir win", async () => {
    const fromEnv = read('{"oauthAccount":{}}', {
      env: { CLAUDE_CONFIG_DIR: "/Users/me/.claude-work" },
    })
    expect(fromEnv.paths).toEqual(["/Users/me/.claude-work/.claude.json"])

    const explicit = read('{"oauthAccount":{}}', {
      env: { CLAUDE_CONFIG_DIR: "/Users/me/.claude-work" },
      configDir: "/tmp/claude-config",
    })
    expect(explicit.paths).toEqual(["/tmp/claude-config/.claude.json"])

    const forcedDefault = read('{"oauthAccount":{}}', {
      homeDir: "/Users/tester",
      env: { CLAUDE_CONFIG_DIR: "/Users/me/.claude-work" },
      configDir: null,
    })
    expect(forcedDefault.paths).toEqual(["/Users/tester/.claude.json"])
  })

  it("returns null when the file is missing", async () => {
    const { result } = read(new Error("ENOENT"), { homeDir: "/Users/tester" })
    expect(await result).toBeNull()
  })

  it("returns null for invalid JSON", async () => {
    expect(await read(`{not-json ${token}}`).result).toBeNull()
  })

  it("returns null when oauthAccount is missing or not an object", async () => {
    for (const content of [
      "{}",
      '{"oauthAccount":null}',
      '{"oauthAccount":"user@example.com"}',
      "[]",
    ]) {
      expect(await read(content).result).toBeNull()
    }
  })

  it("keeps only non-empty string fields and turns other values into null", async () => {
    const content = JSON.stringify({
      oauthAccount: {
        accountUuid: "",
        emailAddress: 42,
        displayName: "工作账号",
        fullName: null,
        organizationUuid: ["org"],
        organizationName: { name: "Example Org" },
        organizationType: "",
        organizationRateLimitTier: false,
      },
    })
    expect(await read(content).result).toEqual({
      accountUuid: null,
      emailAddress: null,
      displayName: "工作账号",
      fullName: null,
      organizationUuid: null,
      organizationName: null,
      organizationType: null,
      organizationRateLimitTier: null,
    })
  })
})
