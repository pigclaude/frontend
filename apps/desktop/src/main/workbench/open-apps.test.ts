// 负责验证「在外部应用中打开」的应用清单：只列出本机装了的文件管理器、编辑器和终端，以及打开文件夹的命令。
import { delimiter, join } from "node:path"
import { describe, expect, it } from "vitest"
import { folderLaunch, installedOpenApps } from "./open-apps"

describe("installed open apps", () => {
  it("lists macOS file manager, editors and terminals that exist, grouped by kind", () => {
    const present = new Set([
      "/System/Library/CoreServices/Finder.app",
      "/Applications/Cursor.app",
      "/System/Applications/Utilities/Terminal.app",
      "/Applications/Ghostty.app",
    ])

    expect(
      installedOpenApps("darwin", (path) => present.has(path)).map(({ id, kind }) => [id, kind]),
    ).toEqual([
      ["finder", "file-manager"],
      ["cursor", "editor"],
      ["terminal", "terminal"],
      ["ghostty", "terminal"],
    ])
  })

  it("always offers the Linux file manager and finds terminals on PATH", () => {
    const bin = join("/usr", "bin")
    const present = new Set([join(bin, "konsole"), join(bin, "code")])

    expect(
      installedOpenApps("linux", (path) => present.has(path), [bin].join(delimiter)).map(
        ({ id, kind, location }) => [id, kind, location],
      ),
    ).toEqual([
      ["file-manager", "file-manager", ""],
      ["vscode", "editor", join(bin, "code")],
      ["konsole", "terminal", join(bin, "konsole")],
    ])
  })

  it("leaves the file manager to the system and starts other apps in the folder", () => {
    const folder = "/work/api"
    const app = (id: string, kind: "file-manager" | "editor" | "terminal", location: string) => ({
      id,
      name: id,
      kind,
      location,
    })

    expect(folderLaunch(app("finder", "file-manager", "/Finder.app"), folder, "darwin")).toBeNull()
    expect(
      folderLaunch(app("iterm", "terminal", "/Applications/iTerm.app"), folder, "darwin"),
    ).toEqual({ command: "open", args: ["-a", "/Applications/iTerm.app", folder] })
    expect(
      folderLaunch(app("gnome-terminal", "terminal", "/usr/bin/gnome-terminal"), folder, "linux"),
    ).toEqual({ command: "/usr/bin/gnome-terminal", args: [`--working-directory=${folder}`] })
    expect(folderLaunch(app("vscode", "editor", "/usr/bin/code"), folder, "linux")).toEqual({
      command: "/usr/bin/code",
      args: [folder],
    })
    expect(
      folderLaunch(app("windows-terminal", "terminal", "C:\\wt.exe"), "C:\\work\\api", "win32"),
    ).toEqual({ command: "C:\\wt.exe", args: ["-d", "C:\\work\\api"] })
  })
})
