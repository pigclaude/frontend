// 负责验证独立运行目录先于 single instance lock 生效，保护用户正在运行的桌面进程。
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { configureRuntimeProfile } from "./runtime-profile"

describe("桌面运行隔离", () => {
  it("创建独立 userData 后设置路径，最后取得该目录的单实例锁", () => {
    const root = mkdtempSync(join(tmpdir(), "pigclaude-profile-test-"))
    const userData = join(root, "independent")
    const calls: string[] = []
    try {
      expect(
        configureRuntimeProfile(
          {
            setPath: (name, value) => {
              expect(existsSync(value)).toBe(true)
              calls.push(`${name}:${value}`)
            },
            requestSingleInstanceLock: () => {
              calls.push("lock")
              return true
            },
          },
          userData,
        ),
      ).toBe(true)
      expect(calls).toEqual([`userData:${userData}`, "lock"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
