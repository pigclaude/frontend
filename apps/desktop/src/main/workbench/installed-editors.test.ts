// 负责验证本机编辑器的检测、启动命令和环境：只列出找到的编辑器，启动时不带供应商、代理和凭据变量。
import { delimiter, join } from "node:path"
import { describe, expect, it } from "vitest"
import { editorEnv, editorLaunch, installedEditors } from "./installed-editors"

describe("installed editors", () => {
  it("lists only the macOS editors whose app bundle exists, in catalog order", () => {
    const present = new Set(["/Applications/Cursor.app", "/Applications/Visual Studio Code.app"])

    expect(installedEditors("darwin", (path) => present.has(path))).toEqual([
      { id: "vscode", name: "VS Code", location: "/Applications/Visual Studio Code.app" },
      { id: "cursor", name: "Cursor", location: "/Applications/Cursor.app" },
    ])
  })

  it("finds Linux editors on PATH and skips commands that are not there", () => {
    const bin = join("/opt", "zed", "bin")
    const present = new Set([join(bin, "zeditor"), join("/usr/bin", "code")])

    expect(
      installedEditors("linux", (path) => present.has(path), ["/usr/bin", bin].join(delimiter)),
    ).toEqual([
      { id: "vscode", name: "VS Code", location: join("/usr/bin", "code") },
      { id: "zed", name: "Zed", location: join(bin, "zeditor") },
    ])
  })

  it("opens files through open -a on macOS and the executable elsewhere", () => {
    const cursor = { id: "cursor", name: "Cursor", location: "/Applications/Cursor.app" }
    const code = { id: "vscode", name: "VS Code", location: "C:\\Programs\\Code.exe" }

    expect(editorLaunch(cursor, "/repo/src/index.ts", "darwin")).toEqual({
      command: "open",
      args: ["-a", "/Applications/Cursor.app", "/repo/src/index.ts"],
    })
    expect(editorLaunch(code, "C:\\repo\\index.ts", "win32")).toEqual({
      command: "C:\\Programs\\Code.exe",
      args: ["C:\\repo\\index.ts"],
    })
  })

  it("keeps the graphical session but drops provider, proxy and token variables", () => {
    expect(
      editorEnv({
        PATH: "/usr/bin",
        HOME: "/home/me",
        DISPLAY: ":0",
        WAYLAND_DISPLAY: "wayland-0",
        XDG_RUNTIME_DIR: "/run/user/1000",
        ANTHROPIC_AUTH_TOKEN: "fixture",
        HTTPS_PROXY: "http://user:secret@proxy.test:8080",
        PIGCLAUDE_DEV_PROVIDER_AUTH_TOKEN: "fixture",
      }),
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/me",
      DISPLAY: ":0",
      WAYLAND_DISPLAY: "wayland-0",
      XDG_RUNTIME_DIR: "/run/user/1000",
    })
  })
})
