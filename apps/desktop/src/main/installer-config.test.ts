// 负责验证安装包的固定身份、私有协议、仅发布构建产物的白名单、打包时关闭的 fuses，以及三平台安装包和更新源的配置。
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
        target: [
          { target: "dmg", arch: ["arm64"] },
          { target: "zip", arch: ["arm64"] },
        ],
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

  it("打包时关闭 Node 调试参数和 NODE_OPTIONS；Xray 守护程序还要 RunAsNode", () => {
    const config = JSON.parse(readFileSync(configPath, "utf8"))
    expect(config.electronFuses).toEqual({
      runAsNode: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
    })
  })
})

describe("三平台发布配置", () => {
  const config = JSON.parse(readFileSync(configPath, "utf8"))

  it("Windows 用 NSIS 按用户安装，不需要管理员权限", () => {
    expect(config.win.target).toEqual([{ target: "nsis", arch: ["x64"] }])
    expect(config.nsis).toMatchObject({ oneClick: true, perMachine: false })
  })

  it("Linux 的 AppImage 文件名不带版本号，更新后协议关联和开机自启仍指向同一路径", () => {
    expect(config.linux.target).toEqual([{ target: "AppImage", arch: ["x64"] }])
    expect(config.linux.artifactName).not.toContain("${version}")
    expect(config.linux.executableName).toBe("pigclaude")
  })

  it("更新清单指向公开发布仓库", () => {
    expect(config.publish).toEqual([{ provider: "github", owner: "pigclaude", repo: "release" }])
  })

  it("发布构建继承本机安装包配置并覆盖两项公开服务地址", () => {
    const releaseConfig = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../electron-builder.release.json"), "utf8"),
    )
    expect(releaseConfig).toEqual({
      extends: "./electron-builder.json",
      extraMetadata: {
        pigclaudeEndpoints: {
          rustBaseUrl: "https://api.pigclaude.com",
          authOrigin: "https://www.pigclaude.com",
        },
      },
    })
  })
})
