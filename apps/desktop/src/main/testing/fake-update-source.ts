// 负责测试用的本地假更新源：在本机回环上提供最新发布、macOS 更新清单和 DMG，可以按需返回错误或改坏文件。
import { createHash } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

/** 假更新源的可调项：发布的版本、DMG 内容，以及各个路径要返回的错误。 */
export type FakeUpdateSourceOptions = {
  version: string
  dmg?: Buffer
  /** 清单里登记的 DMG 内容；和 dmg 不同时模拟下载被换过。 */
  manifestDmg?: Buffer
  releaseStatus?: number
  dmgStatus?: number
  withManifest?: boolean
}

/** 运行中的假更新源。 */
export type FakeUpdateSource = {
  apiUrl: string
  releaseUrl: string
  requests: string[]
  close(): Promise<void>
}

/** 在 127.0.0.1 的随机端口上启动假更新源。 */
export async function startFakeUpdateSource(
  options: FakeUpdateSourceOptions,
): Promise<FakeUpdateSource> {
  const dmg = options.dmg ?? Buffer.from("dmg-content")
  const listed = options.manifestDmg ?? dmg
  const dmgName = `PigClaude-${options.version}-arm64.dmg`
  const requests: string[] = []
  let origin = ""
  const server: Server = createServer((request, response) => {
    const path = request.url ?? "/"
    requests.push(path)
    if (path === "/releases/latest") {
      response.statusCode = options.releaseStatus ?? 200
      const assets = [{ name: dmgName, browser_download_url: `${origin}/download/${dmgName}` }]
      if (options.withManifest !== false) {
        assets.push({
          name: "latest-mac.yml",
          browser_download_url: `${origin}/download/latest-mac.yml`,
        })
      }
      response.end(
        JSON.stringify({
          tag_name: `v${options.version}`,
          html_url: `${origin}/pigclaude/release/releases/tag/v${options.version}`,
          draft: false,
          prerelease: false,
          assets,
        }),
      )
    } else if (path === "/download/latest-mac.yml") {
      response.end(
        [
          `version: ${options.version}`,
          "files:",
          `  - url: PigClaude-${options.version}-arm64.zip`,
          "    sha512: zip",
          "    size: 3",
          `  - url: ${dmgName}`,
          `    sha512: ${createHash("sha512").update(listed).digest("base64")}`,
          `    size: ${listed.length}`,
          `path: PigClaude-${options.version}-arm64.zip`,
          "",
        ].join("\n"),
      )
    } else if (path === `/download/${dmgName}`) {
      response.statusCode = options.dmgStatus ?? 200
      response.end(response.statusCode === 200 ? dmg : "")
    } else {
      response.statusCode = 404
      response.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    apiUrl: `${origin}/releases/latest`,
    releaseUrl: `${origin}/pigclaude/release/releases/tag/v${options.version}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
