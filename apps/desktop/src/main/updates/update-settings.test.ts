// 验证自动检查开关的保存，以及各平台的更新方式。
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { updateMode } from "./update-mode"
import { readAutoCheck, writeAutoCheck } from "./update-settings"

describe("自动检查开关", () => {
  let directory = ""
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it("默认开启；保存后读回；文件损坏时按开启处理", async () => {
    directory = await mkdtemp(join(tmpdir(), "pigclaude-update-settings-"))
    const file = join(directory, "nested", "update-settings.json")
    expect(readAutoCheck(file)).toBe(true)
    await writeAutoCheck(file, false)
    expect(readAutoCheck(file)).toBe(false)
    await writeAutoCheck(file, true)
    expect(readAutoCheck(file)).toBe(true)
    await writeFile(file, "{not json")
    expect(readAutoCheck(file)).toBe(true)
  })
})

describe("更新方式", () => {
  it("Windows 和 AppImage 后台安装，macOS 手动替换，其余只打开发布页", () => {
    expect(updateMode("win32", {}, true)).toBe("install")
    expect(updateMode("linux", { APPIMAGE: "/opt/PigClaude.AppImage" }, true)).toBe("install")
    expect(updateMode("linux", {}, true)).toBe("notify")
    expect(updateMode("darwin", {}, true)).toBe("replace")
    expect(updateMode("darwin", {}, false)).toBe("notify")
    expect(updateMode("win32", {}, false)).toBe("notify")
  })
})
