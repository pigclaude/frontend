// 验证主进程打包时打进包的依赖：安装包不带上的运行时依赖都要打进主进程包。
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { mainBundledDependencies } from "./main-bundled-dependencies"

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, "../..", name), "utf8"))
}

describe("主进程打进包的依赖", () => {
  it("安装包 files 白名单带上的依赖留在外部，其余运行时依赖都打进主进程包", () => {
    const manifest = { dependencies: { zod: "1", "native-addon": "1", "@scope/sdk": "1" } }
    const installer = {
      files: ["out/main/**", "node_modules/native-addon/**", "node_modules/@scope/sdk/**"],
    }
    expect(mainBundledDependencies(manifest, installer)).toEqual(["zod"])
  })

  it("当前配置下主进程直接引用的 zod 打进包，随安装包带上的 Claude Agent SDK 不打进包", () => {
    const bundled = mainBundledDependencies(
      readJson("package.json"),
      readJson("electron-builder.json"),
    )
    expect(bundled).toContain("zod")
    expect(bundled).toContain("@pigclaude/daemon")
    expect(bundled).not.toContain("@anthropic-ai/claude-agent-sdk")
    expect(bundled).not.toContain("node-pty")
  })
})
