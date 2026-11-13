// 负责核对工作区或暂存区的 Pigcode 界面包，文件集合及 SHA256 必须匹配固定提交清单。
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { vendoredPackages } from "./pigcode-package-map.mjs"

const rootIndex = process.argv.indexOf("--root")
const root = rootIndex === -1 ? join(import.meta.dirname, "..") : process.argv[rootIndex + 1]
const staged = process.argv.includes("--staged")

function git(...args) {
  return execFileSync("git", ["-C", root, ...args], { maxBuffer: 16 * 1024 * 1024 })
}

async function readSource(path) {
  return staged ? git("show", `:${path}`) : readFile(join(root, path))
}

const lock = JSON.parse((await readSource("pigcode-source.json")).toString("utf8"))
if (!/^[0-9a-f]{40}$/.test(lock.commit ?? "")) {
  console.error("pigcode-source.json: commit must be a full 40-character SHA")
  process.exit(1)
}

const expected = new Map(lock.files.map((file) => [file.path, file.sha256]))
const packages = vendoredPackages.map(({ target }) => `packages/${target}`)
const failures = []
if (expected.size !== lock.files.length) failures.push("pigcode-source.json: duplicate paths")
for (const pkg of packages) {
  if (!expected.has(`${pkg}/package.json`)) failures.push(`${pkg}: missing package manifest entry`)
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === "node_modules") continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else files.push(path)
  }
  return files
}

const actualPaths = staged
  ? git("ls-files", "--cached", "-z", "--", ...packages)
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
  : (await Promise.all(packages.map((pkg) => walk(join(root, pkg)))))
      .flat()
      .map((path) => relative(root, path).split(sep).join("/"))

const seen = new Set(actualPaths)
for (const path of seen) {
  const want = expected.get(path)
  if (!want) {
    failures.push(`${path}: not in pigcode-source.json`)
    continue
  }
  const actual = createHash("sha256")
    .update(await readSource(path))
    .digest("hex")
  if (actual !== want)
    failures.push(`${path}: content differs from Pigcode ${lock.commit.slice(0, 7)}`)
}
for (const path of expected.keys()) {
  if (!seen.has(path)) failures.push(`${path}: listed in pigcode-source.json but missing`)
}

if (failures.length) {
  for (const failure of failures) console.error(failure)
  console.error(
    "拷入的 Pigcode 代码只能用 scripts/vendor-pigcode.mjs 从固定提交重新生成；PigClaude 的改动放在适配层。",
  )
  process.exit(1)
}
console.log(
  `Pigcode source verified: ${expected.size} files in ${packages.length} packages match ${lock.repository}@${lock.commit}`,
)
