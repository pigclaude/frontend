// 负责验证安装包的固定身份、私有协议和仅发布构建产物的白名单。
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const configPath = resolve(import.meta.dirname, "../../electron-builder.json")

describe("macOS 安装包配置", () => {
  it("使用独立产品名，避免安装包默认复用开发版用户数据", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
    )
    expect(manifest.productName).toBe("PigClaude")
  })

  it("固定 bundle 身份、私有协议、Electron 版本和 ad-hoc 签名", () => {
    expect(existsSync(configPath)).toBe(true)
    if (!existsSync(configPath)) return
    const config = JSON.parse(readFileSync(configPath, "utf8"))
    expect(config).toMatchObject({
      appId: "com.pigclaude.desktop",
      productName: "PigClaude",
      electronVersion: "43.4.1",
      asar: true,
      protocols: [{ name: "PigClaude authorization", schemes: ["pigclaude"] }],
      mac: {
        identity: "-",
        hardenedRuntime: true,
        notarize: false,
        target: [{ target: "dmg", arch: ["arm64"] }],
      },
    })
    expect(config.files).toEqual([
      "out/main/**",
      "out/preload/**",
      "out/renderer/**",
      "package.json",
      "!**/*.map",
      "!**/.env*",
      "!**/*.{test,spec}.*",
      "!node_modules/**",
      "node_modules/@anthropic-ai/claude-agent-sdk/**",
      "node_modules/@anthropic-ai/claude-agent-sdk-*/**",
      "node_modules/node-pty/**",
      "node_modules/node-addon-api/**",
    ])
    expect(config.asarUnpack).toEqual([
      "node_modules/@anthropic-ai/claude-agent-sdk/**",
      "node_modules/@anthropic-ai/claude-agent-sdk-*/**",
      "node_modules/node-pty/**",
    ])
    expect(config.extraMetadata.pigclaudeEndpoints).toEqual({
      rustBaseUrl: "http://127.0.0.1:8788",
      authOrigin: "http://127.0.0.1:3000",
    })
  })
})
