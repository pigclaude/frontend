// 使用 AppImage 内的真实 CLI 复核语言时区和合成协议，诊断只发送本机占位请求。
import { writeFile } from "node:fs/promises"
import { expect, it } from "vitest"
import { probeNativeCli } from "./native-cli-probe"

it("test.11 安装内原生 CLI 的语言时区和协议材料符合保存的配置", async () => {
  const binary = process.env["QA_INSTALLED_CLAUDE"]
  const output = process.env["QA_NATIVE_OUTPUT"]
  if (!binary || !output) throw new Error("缺少安装内 CLI 或证据路径")
  const observation = await probeNativeCli({
    binary,
    locale: "en-US",
    timezone: "America/Chicago",
    signal: AbortSignal.timeout(30_000),
  })
  await writeFile(output, JSON.stringify(observation, null, 2) + "\n")
  expect(observation).toMatchObject({
    launched: true,
    configurationPrivate: true,
    localeAvailable: true,
    launchEnvironmentMatches: true,
    legacyPreloadRemoved: true,
    nativeCredentialIsPlaceholder: true,
    protocolPreserved: true,
  })
}, 45_000)
