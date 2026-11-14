// 负责发版工作流的两项核对：tag 与桌面端版本一致；三平台更新清单列出的版本、文件、大小和 sha512 与实际制品一致。

const { createHash } = require("node:crypto")
const { readFileSync, statSync } = require("node:fs")
const { join } = require("node:path")

const VERSION = /^\d+\.\d+\.\d+$/
const TEST_TAG = /^desktop-v\d+\.\d+\.\d+-test\.\d+$/

/** 三个平台的更新清单，以及每份清单必须列出的安装包后缀。 */
const MANIFESTS = {
  "latest-mac.yml": [".zip", ".dmg"],
  "latest.yml": [".exe"],
  "latest-linux.yml": [".AppImage"],
}

/**
 * 决定这次发版的 tag 和版本。推 tag 时 tag 必须是 `v<桌面端版本>`；
 * 手动触发的测试发布只接受 `desktop-v<x.y.z>-test.<n>` 这样的 tag，版本仍取桌面端版本。
 */
function releaseTarget({ event, pushedTag, testTag, version }) {
  if (!VERSION.test(version)) throw new Error(`桌面端版本 ${version} 不是 x.y.z`)
  if (event === "workflow_dispatch") {
    if (!TEST_TAG.test(testTag ?? "")) {
      throw new Error(`测试发布的 tag 必须形如 desktop-v0.0.0-test.1，收到 ${testTag}`)
    }
    return { tag: testTag, version, test: true }
  }
  if (pushedTag !== `v${version}`) {
    throw new Error(`tag ${pushedTag} 与桌面端版本 ${version} 不一致，应为 v${version}`)
  }
  return { tag: pushedTag, version, test: false }
}

/** 读出 electron-builder 更新清单里的版本、文件列表和 Linux 安装包路径；只认这几项。 */
function parseUpdateManifest(text) {
  const manifest = { version: null, path: null, files: [] }
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const top = /^(version|path):\s*'?([^']*)'?\s*$/.exec(line)
    if (top) {
      manifest[top[1]] = top[2]
      current = null
      continue
    }
    const entry = /^\s*-\s+url:\s*(.+)$/.exec(line)
    if (entry) {
      current = { url: entry[1].trim(), sha512: null, size: null }
      manifest.files.push(current)
      continue
    }
    const field = /^\s+(sha512|size):\s*(.+)$/.exec(line)
    if (field && current) {
      current[field[1]] = field[1] === "size" ? Number(field[2]) : field[2].trim()
    }
  }
  return manifest
}

/** 核对目录里三份更新清单和它们列出的安装包；返回问题列表，空数组表示通过。 */
function releaseAssetProblems(directory, version) {
  const problems = []
  for (const [name, suffixes] of Object.entries(MANIFESTS)) {
    let manifest
    try {
      manifest = parseUpdateManifest(readFileSync(join(directory, name), "utf8"))
    } catch {
      problems.push(`缺少更新清单 ${name}`)
      continue
    }
    if (manifest.version !== version) {
      problems.push(`${name} 的版本是 ${manifest.version}，应为 ${version}`)
    }
    for (const suffix of suffixes) {
      if (!manifest.files.some((file) => file.url.endsWith(suffix))) {
        problems.push(`${name} 没有列出 ${suffix} 安装包`)
      }
    }
    for (const file of manifest.files) problems.push(...fileProblems(directory, name, file))
  }
  return problems
}

function fileProblems(directory, manifestName, file) {
  const path = join(directory, file.url)
  let size
  try {
    size = statSync(path).size
  } catch {
    return [`${manifestName} 列出的 ${file.url} 不存在`]
  }
  const problems = []
  if (size !== file.size) problems.push(`${file.url} 的大小和 ${manifestName} 不一致`)
  if (sha512(path) !== file.sha512) problems.push(`${file.url} 的 sha512 和 ${manifestName} 不一致`)
  return problems
}

/** 文件的 sha512，base64 编码，和 electron-builder 更新清单的写法相同。 */
function sha512(path) {
  return createHash("sha512").update(readFileSync(path)).digest("base64")
}

module.exports = { parseUpdateManifest, releaseAssetProblems, releaseTarget, sha512 }

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2)
  if (command === "target") {
    const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"))
    const target = releaseTarget({
      event: process.env.GITHUB_EVENT_NAME,
      pushedTag: process.env.GITHUB_REF_NAME,
      testTag: process.env.TEST_TAG,
      version,
    })
    console.log(`tag=${target.tag}\nversion=${target.version}\ntest=${target.test}`)
  } else if (command === "assets") {
    const problems = releaseAssetProblems(args[0], args[1])
    if (problems.length > 0) throw new Error(`发布制品不完整：\n- ${problems.join("\n- ")}`)
    console.log("三平台更新清单和安装包一致")
  } else {
    throw new Error("用法：release-check.cjs target | assets <目录> <版本>")
  }
}
