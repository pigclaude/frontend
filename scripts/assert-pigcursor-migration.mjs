// 负责验证 pigcursor 固定 Git 来源、迁移源码清单、包 scope 和运行时路径边界。
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const sourceRoot = "/Users/liuqin/Documents/workspace/typescript/pigcursor/frontend"
const sourceCommit = "f6ff3383a2119d7030ea2cd21b0544671ad676bd"
const sourceManifest = {
  repository: "pigcursor/frontend",
  commit: sourceCommit,
  files: {
    "packages/web-ui/package.json":
      "0c62821711c1eeccd3420a82a25bb71cfbb3b16cfebc6f7b63d6191559ec1f20",
    "packages/api/src/client.ts":
      "511658cce282433d633ecf7729bd5aeb8581d4dc1ec7243c83dbe005052d51ff",
    "packages/api/src/home/endpoints.ts":
      "07bebca80fc6269f7453d9c0d4c62057c8e1bf567dee0cd349ed2ed06111be19",
    "packages/api/src/home/types.ts":
      "f48efbbc4958029b993046471aed46e1e4844072fd3aa2e1925587e7fdb19d60",
    "packages/api/src/admin/endpoints.ts":
      "14d8ddfb01f00c8c029ffb98aeaf5b34f0a0bd6d891594ed7394ebea6d3fa59b",
    "packages/api/src/admin/types.ts":
      "acd6fc21abac654a376de6d45fb6592a8eadeb2a437e236856e019e4b317c716",
  },
}
function git(...args) {
  return execFileSync("git", ["-C", sourceRoot, ...args], { encoding: "utf8" }).trim()
}
function gitBlob(...args) {
  return execFileSync("git", ["-C", sourceRoot, ...args])
}
let resolved
try {
  resolved = git("rev-parse", `${sourceCommit}^{commit}`)
} catch {
  throw new Error(`pigcursor source checkout cannot resolve ${sourceCommit}: ${sourceRoot}`)
}
if (resolved !== sourceCommit)
  throw new Error(`pigcursor source resolved to ${resolved}, expected ${sourceCommit}`)
for (const [file, expectedHash] of Object.entries(sourceManifest.files)) {
  const blob = gitBlob("show", `${sourceCommit}:${file}`)
  const hash = createHash("sha256").update(blob).digest("hex")
  if (!expectedHash || hash !== expectedHash)
    throw new Error(`source manifest mismatch for ${file}: ${hash}`)
}
const expected = ["@pigclaude/web-ui", "@pigclaude/api", "@pigclaude/contracts"]
const layout = JSON.parse(await readFile(join(root, "layout.json"), "utf8"))
const packageDirs = await readdir(join(root, "packages"), { withFileTypes: true })
const packageNames = []
for (const entry of packageDirs) {
  if (!entry.isDirectory()) continue
  try {
    packageNames.push(
      JSON.parse(await readFile(join(root, "packages", entry.name, "package.json"), "utf8")).name,
    )
  } catch {}
}
for (const name of expected) {
  if (!layout.packages.includes(name.slice("@pigclaude/".length)))
    throw new Error(`layout missing ${name}`)
  if (!packageNames.includes(name)) throw new Error(`package missing ${name}`)
}
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    if (["node_modules", "dist"].includes(entry.name)) continue
    const file = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...(await files(file)))
    else if (/\.(ts|tsx|css)$/.test(entry.name)) result.push(file)
  }
  return result
}
for (const name of ["web-ui", "api", "contracts"]) {
  for (const file of await files(join(root, "packages", name, "src"))) {
    const lines = (await readFile(file, "utf8")).split(/\r?\n/)
    const first = lines.find((line) => line.trim().length > 0) ?? ""
    if (!/[\u4e00-\u9fff]/.test(first) || !/^(?:\/\/|\/\*)/.test(first.trim())) {
      throw new Error(`${file} must start with a Chinese responsibility comment`)
    }
    for (let index = 0; index < lines.length; index += 1) {
      if (
        !/^\s*export\s+(?:type|interface|const|class|function|async\s+function)/.test(lines[index])
      )
        continue
      const previous =
        lines
          .slice(0, index)
          .reverse()
          .find((line) => line.trim().length > 0) ?? ""
      if (!/[\u4e00-\u9fff]/.test(previous) || !/^(?:\/\/|\/\*)/.test(previous.trim())) {
        throw new Error(`${file}:${index + 1} exported symbol lacks Chinese responsibility comment`)
      }
    }
    const source = await readFile(file, "utf8")
    if (source.includes("@pigcursor/")) throw new Error(`${file} imports @pigcursor/*`)
    if (source.includes(sourceRoot)) throw new Error(`${file} imports pigcursor checkout path`)
  }
}
console.log(`pigcursor migration ${sourceCommit} verified for ${expected.join(", ")}`)
