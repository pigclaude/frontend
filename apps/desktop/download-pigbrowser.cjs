// 负责从 GitHub Release 下载固定的 PigBrowser 开发包，校验后再交给打包流程。

const { spawnSync } = require("node:child_process")
const { createWriteStream } = require("node:fs")
const { mkdir, mkdtemp, rename, rm } = require("node:fs/promises")
const { join } = require("node:path")
const { pipeline } = require("node:stream/promises")
const artifacts = require("./pigbrowser-artifacts.json")
const { hashFile, pigbrowserArtifact, pigbrowserVersion } = require("./pigbrowser-resources.cjs")

const TOKEN_SECRET = "PIGBROWSER_READ_TOKEN"

/** 返回当前平台的仓库、版本 tag、附件名和锁定的 SHA-256。 */
function pigbrowserRelease(target) {
  const artifact = pigbrowserArtifact(target)
  return {
    repository: artifacts.repository,
    tag: `v${pigbrowserVersion()}`,
    archive: artifact.archive,
    sha256: artifact.sha256,
  }
}

/** 下载并核对完整文件。传入只读令牌时支持私有仓，失败时保留目录里已有的包。 */
async function fetchPigbrowserArchive({ release, dir, token, run = runGh, fetcher = fetch }) {
  await mkdir(dir, { recursive: true })
  const pending = await mkdtemp(join(dir, ".pigbrowser-"))
  try {
    const path = join(pending, release.archive)
    const where = `${release.repository} 的 Release ${release.tag}`
    if (token?.trim()) downloadPrivate(release, pending, token.trim(), run, where)
    else await downloadPublic(release, path, fetcher, where)
    if ((await hashFile(path)) !== release.sha256) {
      throw new Error(
        `PigBrowser 包校验失败：${release.archive} 的 sha256 与 pigbrowser-artifacts.json 不一致`,
      )
    }
    const archive = join(dir, release.archive)
    await rename(path, archive)
    return archive
  } finally {
    await rm(pending, { recursive: true, force: true })
  }
}

async function downloadPublic(release, path, fetcher, where) {
  const tag = encodeURIComponent(release.tag)
  const metadata = await fetcher(
    `https://api.github.com/repos/${release.repository}/releases/tags/${tag}`,
    { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(30_000) },
  )
  if (!metadata.ok) {
    await metadata.body?.cancel()
    throw new Error(
      `匿名读取 ${where} 失败（HTTP ${metadata.status}）。请确认 Release 已发布；私有仓需要只读 ${TOKEN_SECRET}`,
    )
  }
  const found = await metadata.json()
  if (found?.draft !== false) throw new Error(`${where} 未公开发布`)
  const published =
    Array.isArray(found.assets) &&
    found.assets.some((asset) => asset?.name === release.archive && asset?.state === "uploaded")
  if (!published) throw new Error(`${where} 里没有已上传的附件 ${release.archive}`)

  const archive = encodeURIComponent(release.archive)
  const download = await fetcher(
    `https://github.com/${release.repository}/releases/download/${tag}/${archive}`,
    { signal: AbortSignal.timeout(10 * 60_000) },
  )
  if (!download.ok || !download.body) {
    await download.body?.cancel()
    throw new Error(`下载 ${where} 的附件 ${release.archive} 失败（HTTP ${download.status}）`)
  }
  await pipeline(download.body, createWriteStream(path, { flags: "wx" }))
}

function downloadPrivate(release, dir, token, run, where) {
  const env = { GH_TOKEN: token }
  const view = run(
    ["release", "view", release.tag, "--repo", release.repository, "--json", "assets,isDraft"],
    env,
  )
  if (view.status !== 0) {
    throw new Error(
      `读取 ${where} 失败：${view.stderr.trim()}（检查 Release 是否存在且已发布，草稿对只读令牌不可见；以及令牌能否读取该仓库）`,
    )
  }
  const found = JSON.parse(view.stdout)
  if (found.isDraft) throw new Error(`${where} 还是草稿，只读令牌看不到草稿；请先发布它`)
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

async function main() {
  try {
    const args = process.argv.slice(2)
    const option = (name) => {
      const value = args[args.indexOf(name) + 1]
      if (!args.includes(name) || !value) throw new Error(`缺少参数 ${name}`)
      return value
    }
    const path = await fetchPigbrowserArchive({
      release: pigbrowserRelease(option("--target")),
      dir: option("--dir"),
      token: process.env[TOKEN_SECRET],
    })
    process.stdout.write(`${path}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}

if (require.main === module) void main()
