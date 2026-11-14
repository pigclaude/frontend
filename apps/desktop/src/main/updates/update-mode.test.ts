// 验证各平台发现新版本后的更新方式：只有安装包能更新，Windows 和 AppImage 后台安装，macOS 手动替换。
import { describe, expect, it } from "vitest"
import { updateMode } from "./update-mode"

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
