// 负责审计拷入的 Pigcode 界面包：每个文件都要与 pigcode-source.json 记录的 SHA256 一致，且没有清单外的文件。
// 拷入的代码只能通过 scripts/vendor-pigcode.mjs 从固定提交重新生成，不能直接修改。
import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join, relative } from "node:path"

const rootIndex = process.argv.indexOf("--root")
const root = rootIndex === -1 ? join(import.meta.dirname, "..") : process.argv[rootIndex + 1]
const lock = JSON.parse(await readFile(join(root, "pigcode-source.json"), "utf8"))

if (!/^[0-9a-f]{40}$/.test(lock.commit ?? "")) {
  console.error("pigcode-source.json: commit must be a full 40-character SHA")
  process.exit(1)
}

const expected = new Map(lock.files.map((file) => [file.path, file.sha256]))
const packages = [...new Set(lock.files.map((file) => file.path.split("/").slice(0, 2).join("/")))]
const failures = []

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

const seen = new Set()
for (const pkg of packages) {
  for (const absolute of await walk(join(root, pkg))) {
    const path = relative(root, absolute).split("\\").join("/")
    seen.add(path)
    const want = expected.get(path)
    if (!want) {
      failures.push(`${path}: not in pigcode-source.json`)
      continue
    }
    const actual = createHash("sha256")
      .update(await readFile(absolute))
      .digest("hex")
    if (actual !== want)
      failures.push(`${path}: content differs from Pigcode ${lock.commit.slice(0, 7)}`)
  }
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
