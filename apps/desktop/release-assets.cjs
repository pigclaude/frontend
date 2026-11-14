// 负责核对发布制品：三平台更新清单列出的版本、文件、大小和 sha512 与实际安装包一致。

const { createHash } = require("node:crypto")
const { readFileSync, statSync } = require("node:fs")
const { join } = require("node:path")

/** 三个平台的更新清单，以及每份清单必须列出的安装包后缀。 */
const MANIFESTS = {
  "latest-mac.yml": [".zip", ".dmg"],
  "latest.yml": [".exe"],
  "latest-linux.yml": [".AppImage"],
}

/** 读出 electron-builder 更新清单里的版本和文件列表；只认这几项。 */
function parseUpdateManifest(text) {
  const manifest = { version: null, files: [] }
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const top = /^version:\s*["']?([^"'\s]+)["']?\s*$/.exec(line)
    if (top) {
      manifest.version = top[1]
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
  const sha512 = createHash("sha512").update(readFileSync(path)).digest("base64")
  if (sha512 !== file.sha512) problems.push(`${file.url} 的 sha512 和 ${manifestName} 不一致`)
  return problems
}

module.exports = { parseUpdateManifest, releaseAssetProblems }

if (require.main === module) {
  const [directory, version] = process.argv.slice(2)
  const problems =
    directory && version ? releaseAssetProblems(directory, version) : ["用法：<目录> <版本>"]
  if (problems.length > 0) {
    process.stderr.write(`发布制品不完整：\n- ${problems.join("\n- ")}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write("三平台更新清单和安装包一致\n")
  }
}
