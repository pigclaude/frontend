// 负责核对前端 apps、packages 与 layout.json 是否一致，并检查包源码的依赖和写法。
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const electronEntries = new Set([
  join(root, "apps/desktop/src/main/index.ts"),
  join(root, "apps/desktop/src/preload/index.ts"),
])
const layout = JSON.parse(await readFile(join(root, "layout.json"), "utf8"))

async function directoryNames(relative) {
  const entries = await readdir(join(root, relative), { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function same(actual, expected, label) {
  const left = actual.join(",")
  const right = [...expected].sort().join(",")
  if (left !== right) {
    console.error(`${label}: expected ${right} but found ${left}`)
    process.exitCode = 1
  }
}

same(await directoryNames("apps"), layout.apps, "apps")
same(await directoryNames("packages"), layout.packages, "packages")

const allowedWorkspaceImport = {
  "login-gate": new Set(["@pigclaude/local-store"]),
}
const bannedFragments = {
  "permission-client": ["@pigclaude/", "node:http", "node:net"],
  "local-store": ["@pigclaude/", "node:http", "node:net"],
  switcher: ["@pigclaude/", "node:fs", "node:http", "node:net"],
  daemon: ["@pigclaude/", "node:fs"],
  "session-env": ["@pigclaude/", "node:fs", "node:http", "node:net"],
  "login-gate": ["@pigclaude/", "node:fs", "node:http", "node:net"],
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)))
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path)
  }
  return files
}

for (const name of layout.packages) {
  const sourceRoot = join(root, "packages", name, "src")
  let files = []
  try {
    files = await sourceFiles(sourceRoot)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  for (const file of files) {
    const source = await readFile(file, "utf8")
    for (const fragment of bannedFragments[name]) {
      if (!source.includes(fragment)) continue
      const allowed = allowedWorkspaceImport[name]
      if (fragment === "@pigclaude/" && allowed) {
        const imports = source.matchAll(/@pigclaude\/[a-z0-9-]+/g)
        for (const match of imports) {
          if (!allowed.has(match[0])) {
            console.error(`${file} imports ${match[0]}`)
            process.exitCode = 1
          }
        }
        continue
      }
      console.error(`${file} contains ${fragment}`)
      process.exitCode = 1
    }
  }
}

async function typescriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue
      files.push(...(await typescriptFiles(path)))
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(path)
    }
  }
  return files
}

for (const relative of ["apps", "packages"]) {
  let files = []
  try {
    files = await typescriptFiles(join(root, relative))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  for (const file of files) {
    const source = await readFile(file, "utf8")
    const parts = source.split("\n")
    const lines = source.endsWith("\n") ? parts.length - 1 : parts.length
    if (lines > 500) {
      console.error(`${file} has ${lines} lines; limit is 500`)
      process.exitCode = 1
    }
    if ((file.endsWith("/index.ts") || file.endsWith("/index.tsx")) && !electronEntries.has(file)) {
      console.error(`${file} barrel is not allowed`)
      process.exitCode = 1
    }
    for (const pattern of [/:\s*any\b/, /\bas any\b/, /@ts-ignore/, /@ts-expect-error/]) {
      if (pattern.test(source)) {
        console.error(`${file} contains ${pattern}`)
        process.exitCode = 1
      }
    }
    if (!hasChineseFileComment(source)) {
      console.error(`${file} is missing a Chinese file comment`)
      process.exitCode = 1
    }
  }
}

function hasChineseFileComment(source) {
  const text = source.trimStart()
  let comment = ""
  if (text.startsWith("/*")) {
    const end = text.indexOf("*/")
    comment = end === -1 ? "" : text.slice(0, end)
  } else if (text.startsWith("//")) {
    const lines = []
    for (const line of text.split("\n")) {
      if (line.trimStart().startsWith("//")) lines.push(line)
      else break
    }
    comment = lines.join("\n")
  }
  return /[\u4e00-\u9fff]/.test(comment)
}

if (process.exitCode) process.exit(process.exitCode)
