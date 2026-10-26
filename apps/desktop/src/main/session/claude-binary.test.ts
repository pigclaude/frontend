// 负责验证 Claude Code 二进制的解析顺序：环境变量覆盖、打包后的 asar 外路径和平台包回退。

import { describe, expect, it } from "vitest"
import { ClaudeRuntimeUnavailableError, resolveClaudeBinaryPath } from "./claude-binary"

describe("resolveClaudeBinaryPath", () => {
  it("prefers PIGCLAUDE_CLAUDE_BIN over the platform package", () => {
    let resolvedPackages = 0
    const path = resolveClaudeBinaryPath({
      env: { PIGCLAUDE_CLAUDE_BIN: "/custom/claude" },
      resolvePackage: () => {
        resolvedPackages += 1
        return "/package/claude"
      },
      exists: () => true,
    })
    expect(path).toBe("/custom/claude")
    expect(resolvedPackages).toBe(0)
  })

  it("fails when PIGCLAUDE_CLAUDE_BIN does not exist", () => {
    expect(() =>
      resolveClaudeBinaryPath({
        env: { PIGCLAUDE_CLAUDE_BIN: "/missing/claude" },
        exists: () => false,
      }),
    ).toThrow(/PIGCLAUDE_CLAUDE_BIN/)
  })

  it("resolves the platform package for the current target", () => {
    const seen: string[] = []
    const path = resolveClaudeBinaryPath({
      env: {},
      platform: "darwin",
      arch: "arm64",
      resolvePackage: (specifier) => {
        seen.push(specifier)
        return `/packages/${specifier}`
      },
      exists: () => true,
    })
    expect(path).toBe("/packages/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude")
    expect(seen).toEqual(["@anthropic-ai/claude-agent-sdk-darwin-arm64/claude"])
  })

  it("uses the unpacked platform binary inside a packaged app", () => {
    const path = resolveClaudeBinaryPath({
      env: {},
      platform: "darwin",
      arch: "arm64",
      resourcesPath: "/Applications/PigClaude.app/Contents/Resources",
      resolvePackage: () => {
        throw new Error("package missing")
      },
      exists: (candidate) => candidate.includes("app.asar.unpacked"),
    })
    expect(path).toBe(
      "/Applications/PigClaude.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
    )
  })

  it("reports CLAUDE_RUNTIME_UNAVAILABLE when no binary can be found", () => {
    expect(() =>
      resolveClaudeBinaryPath({
        env: {},
        platform: "darwin",
        arch: "arm64",
        resolvePackage: () => {
          throw new Error("missing")
        },
        exists: () => false,
      }),
    ).toThrow(ClaudeRuntimeUnavailableError)
    expect(() =>
      resolveClaudeBinaryPath({
        env: {},
        platform: "darwin",
        arch: "arm64",
        resolvePackage: () => {
          throw new Error("missing")
        },
        exists: () => false,
      }),
    ).toThrow(/CLAUDE_RUNTIME_UNAVAILABLE/)
  })
})
