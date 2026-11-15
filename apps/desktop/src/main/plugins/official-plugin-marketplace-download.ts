// 从固定公开仓库获取官方目录及其分离签名，两份文件绑定同一次提交。

import { downloadMarketplaceBytes, loadMarketplaceArchive } from "./plugin-marketplace-download"
import { pluginMarketplaceCatalogBytesLimit } from "./plugin-marketplace-parser"

/** 官方目录和签名文件所在的固定公开仓库。 */
export const officialPluginMarketplaceRepository = "pigclaude/plugs"
// List commits 未指定 sha 时使用仓库默认分支。
const defaultBranchHead =
  "https://api.github.com/repos/" + officialPluginMarketplaceRepository + "/commits?per_page=1"
const catalogFile = ".claude-plugin/marketplace.json"
const commitResponseLimit = 128 * 1024
const signatureLimit = 4096
const decoder = new TextDecoder("utf-8", { fatal: true })

/** 读取官方目录的原始签名材料，供后续验证。 */
export async function downloadOfficialPluginMarketplace(
  fetcher: typeof fetch = fetch,
): Promise<{ commit: string; catalog: Buffer; signature: Buffer }> {
  try {
    const response = await downloadMarketplaceBytes(defaultBranchHead, fetcher, {
      byteLimit: commitResponseLimit,
    })
    const commit = readCommit(response)
    const { files } = await loadMarketplaceArchive(
      { kind: "github", repo: officialPluginMarketplaceRepository, commit },
      fetcher,
    )
    const catalog = files.get(catalogFile)
    const signature = files.get(catalogFile + ".sig")
    if (
      !catalog?.byteLength ||
      !signature?.byteLength ||
      catalog.byteLength > pluginMarketplaceCatalogBytesLimit ||
      signature.byteLength > signatureLimit
    )
      throw unavailable()
    return { commit, catalog, signature }
  } catch {
    throw unavailable()
  }
}

function readCommit(response: Buffer): string {
  const data: unknown = JSON.parse(decoder.decode(response))
  if (!Array.isArray(data) || data.length !== 1) throw unavailable()
  const head: unknown = data[0]
  if (
    !head ||
    typeof head !== "object" ||
    !("sha" in head) ||
    typeof head.sha !== "string" ||
    head.sha.length !== 40 ||
    !/^[0-9a-f]{40}$/i.test(head.sha)
  )
    throw unavailable()
  return head.sha.toLowerCase()
}

function unavailable(): Error {
  return new Error("PLUGIN_MARKETPLACE_OFFICIAL_UNAVAILABLE")
}
