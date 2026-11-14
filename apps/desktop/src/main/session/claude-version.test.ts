// 负责验证 Claude Code 版本读取：只取版本号，不带用户环境运行，任何失败都返回 null。

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readClaudeCodeVersion } from "./claude-version"

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pigclaude-claude-version-"))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

describe("readClaudeCodeVersion", () => {
  it("takes the version number from the --version output", async () => {
    const seen: string[] = []
    const version = await readClaudeCodeVersion({
      resolveBinary: () => "/bundle/claude",
      run: async (binary) => {
        seen.push(binary)
        return "2.1.310 (Claude Code)\n"
      },
    })

    expect(version).toBe("2.1.310")
    expect(seen).toEqual(["/bundle/claude"])
  })

  it("returns null for unknown output, a failing run or a missing binary", async () => {
    await expect(
      readClaudeCodeVersion({ resolveBinary: () => "/bundle/claude", run: async () => "" }),
    ).resolves.toBeNull()
    await expect(
      readClaudeCodeVersion({
        resolveBinary: () => "/bundle/claude",
        run: async () => {
          throw new Error("spawn ENOENT")
        },
      }),
    ).resolves.toBeNull()
    await expect(
      readClaudeCodeVersion({
        resolveBinary: () => {
          throw new Error("CLAUDE_BINARY_MISSING")
        },
      }),
    ).resolves.toBeNull()
  })

  it.skipIf(process.platform === "win32")(
    "runs the binary without the user's environment",
    async () => {
      const binary = join(directory, "claude")
      await writeFile(
        binary,
        '#!/bin/sh\nif [ -n "$PIGCLAUDE_VERSION_PROBE" ]; then echo leaked; else echo "2.1.310 (Claude Code)"; fi\n',
        "utf8",
      )
      await chmod(binary, 0o755)
      vi.stubEnv("PIGCLAUDE_VERSION_PROBE", "secret")

      await expect(readClaudeCodeVersion({ resolveBinary: () => binary })).resolves.toBe("2.1.310")
    },
  )
})
