// 负责核对桌面端样式类名：tsx 里用到的类必须在某个 CSS 里定义，并列出旧样式里已经没人用的类。
// 用于 #48 收口：删除 Radix 时代的遗留样式后，确认没有遗留未定义的类名。
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const rendererDir = path.join(root, "apps/desktop/src/renderer/src")
const packagesDir = path.join(root, "packages")
const legacyStyleFiles = [
  "apps/desktop/src/renderer/src/styles/app.css",
  "apps/desktop/src/renderer/src/styles/screens.css",
]

/** 有些类名来自运行时拼接，不能当作静态使用；这些名字由脚本显式放行。 */
const allowedUndefined = new Set(["busy", "chat", "chat-new", "onboarding"])

/** 递归收集指定后缀的文件。 */
async function collectFiles(dir, extensions) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(full, extensions)))
    else if (extensions.some((ext) => entry.name.endsWith(ext))) files.push(full)
  }
  return files
}

/** 从 CSS 选择器里取出类名；跳过注释和声明块。 */
function classesInCss(css) {
  const classes = new Set()
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "")
  let prelude = ""
  let inDeclaration = false
  for (const char of source) {
    if (char === "{") {
      if (!inDeclaration) {
        const trimmed = prelude.trim()
        if (trimmed && !trimmed.startsWith("@")) {
          for (const match of trimmed.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(match[1])
        }
      }
      inDeclaration = true
      prelude = ""
    } else if (char === "}") {
      inDeclaration = false
      prelude = ""
    } else if (!inDeclaration && char !== ";") {
      prelude += char
    }
  }
  return classes
}

/** 提取一个字符串里的类名 token，丢弃动态片段。 */
function tokensIn(text, into) {
  for (const token of text.split(/\s+/)) {
    if (/^[A-Za-z_][\w-]*$/.test(token) && !token.endsWith("-")) into.add(token)
  }
}

/** 从 className、cn() 和 classList 调用里收集静态类名。 */
function classesInTsx(source) {
  const classes = new Set()
  for (const match of source.matchAll(
    /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*\})/g,
  )) {
    tokensIn([match[1], match[2], match[3], match[4], match[5]].filter(Boolean).join(" "), classes)
  }
  for (const match of source.matchAll(/className\s*=\s*\{[^}]*\bcn\([^)]*\)/g)) {
    for (const literal of match[0].matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
      tokensIn([literal[1], literal[2], literal[3]].filter(Boolean).join(" "), classes)
    }
  }
  for (const match of source.matchAll(/classList\.(?:add|remove|toggle)\(\s*"([^"]*)"/g))
    tokensIn(match[1], classes)
  return classes
}

/** 从所有字符串字面量里收集类名候选，用来保守判断旧样式是否还有可能被动态用到。 */
function mentionsInSource(source) {
  const classes = new Set()
  for (const match of source.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`]*)`/g)) {
    tokensIn([match[1], match[2], match[3]].filter(Boolean).join(" "), classes)
  }
  return classes
}

const [cssFiles, usageFiles] = await Promise.all([
  collectFiles(rendererDir, [".css"]).then(async (own) => [
    ...own,
    ...(await collectFiles(packagesDir, [".css"])),
  ]),
  // 只核对 PigClaude 自己的界面代码；vendored 包的类名属于上游，不在本仓库的约束内。
  Promise.all([
    collectFiles(rendererDir, [".tsx", ".ts"]),
    collectFiles(path.join(root, "apps/desktop/visual"), [".ts"]),
  ]).then((lists) => lists.flat()),
])

const defined = new Set()
for (const file of cssFiles)
  for (const name of classesInCss(await readFile(file, "utf8"))) defined.add(name)

const used = new Set()
const referenced = new Set()
for (const file of usageFiles) {
  const source = await readFile(file, "utf8")
  for (const name of classesInTsx(source)) used.add(name)
  for (const name of mentionsInSource(source)) referenced.add(name)
}
for (const name of used) referenced.add(name)

const undefinedClasses = [...used]
  .filter((name) => !defined.has(name) && !allowedUndefined.has(name))
  .sort()
const legacyDefined = new Set()
for (const relative of legacyStyleFiles) {
  const css = await readFile(path.join(root, relative), "utf8")
  for (const name of classesInCss(css)) legacyDefined.add(name)
}
const unusedLegacy = [...legacyDefined].filter((name) => !referenced.has(name)).sort()

if (undefinedClasses.length > 0) {
  console.error(`未定义的类名（${undefinedClasses.length}）：${undefinedClasses.join("、")}`)
  process.exitCode = 1
} else {
  console.log(`类名核对通过：${used.size} 个类名都有定义。`)
}
console.log(`旧样式里没有被引用的类名（${unusedLegacy.length}）：${unusedLegacy.join("、")}`)
