// 负责发版时从私有仓库的 Release 下载固定的 PigBrowser 开发包，并按 pigbrowser-artifacts.json 的 sha256 校验。

const { spawnSync } = require("node:child_process")
const { createHash } = require("node:crypto")
const { readFileSync, rmSync } = require("node:fs")
const { join } = require("node:path")
const artifacts = require("./pigbrowser-artifacts.json")
const { pigbrowserArtifact } = require("./pigbrowser-resources.cjs")

const TOKEN_SECRET = "PIGBROWSER_READ_TOKEN"

/** 返回某个平台开发包在私有 Release 里的位置：仓库、`v<版本>` 的 tag、附件名和固定的 sha256。 */
function pigbrowserRelease(target) {
  const artifact = pigbrowserArtifact(target)
  return {
    repository: artifacts.repository,
    tag: `v${artifacts.version}`,
    archive: artifact.archive,
    sha256: artifact.sha256,
  }
}

/**
 * 用只读令牌经 gh 下载开发包到 dir，返回包的路径。令牌缺失、Release 不存在或还是草稿、
 * 附件不存在时说明缺什么；包和固定的 sha256 对不上时删掉它再失败，不留下可被误用的文件。
 */
function fetchPigbrowserArchive({ release, dir, token, run }) {
  if (!token?.trim()) {
    throw new Error(
      `缺少 secret ${TOKEN_SECRET}：读取 ${release.repository} Release 附件的只读令牌`,
    )
  }
  const env = { GH_TOKEN: token }
  const where = `${release.repository} 的 Release ${release.tag}`
  const view = run(
    ["release", "view", release.tag, "--repo", release.repository, "--json", "assets,isDraft"],
    env,
  )
  if (view.status !== 0) {
    throw new Error(
      `读取 ${where} 失败：${view.stderr.trim()}（检查 Release 是否已发布、令牌能否读取该仓库）`,
    )
  }
  const found = JSON.parse(view.stdout)
  if (found.isDraft) throw new Error(`${where} 还是草稿，只读令牌按 tag 取不到附件；请先发布它`)
  const names = found.assets.map((asset) => asset.name)
  if (!names.includes(release.archive)) throw new Error(`${where} 里没有附件 ${release.archive}`)
  const download = run(
    [
      "release",
      "download",
      release.tag,
      "--repo",
      release.repository,
      "--pattern",
      release.archive,
      "--dir",
      dir,
      "--clobber",
    ],
    env,
  )
  if (download.status !== 0) {
    throw new Error(`下载 ${where} 的附件 ${release.archive} 失败：${download.stderr.trim()}`)
  }
  const path = join(dir, release.archive)
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex")
  if (actual !== release.sha256) {
    rmSync(path, { force: true })
    throw new Error(
      `PigBrowser 包校验失败：${release.archive} 的 sha256 与 pigbrowser-artifacts.json 不一致`,
    )
  }
  return path
}

function runGh(args, env) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.error) return { status: 1, stdout: "", stderr: `无法运行 gh：${result.error.message}` }
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

module.exports = { pigbrowserRelease, fetchPigbrowserArchive }

if (require.main === module) {
  try {
    const args = process.argv.slice(2)
    const option = (name) => {
      const value = args[args.indexOf(name) + 1]
      if (!args.includes(name) || !value) throw new Error(`缺少参数 ${name}`)
      return value
    }
    const path = fetchPigbrowserArchive({
      release: pigbrowserRelease(option("--target")),
      dir: option("--dir"),
      token: process.env[TOKEN_SECRET],
      run: runGh,
    })
    process.stdout.write(`${path}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
