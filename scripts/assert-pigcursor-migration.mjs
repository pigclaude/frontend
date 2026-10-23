// 负责审计固定 Pigcursor 来源与目标共享源码的一致性；不宣称页面视觉或业务验收。
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import prettier from "prettier"
import * as postcssPlugin from "prettier/plugins/postcss"
import ts from "typescript"

const targetIndex = process.argv.indexOf("--target-root")
const root =
  targetIndex === -1
    ? join(import.meta.dirname, "..")
    : resolve(process.argv[targetIndex + 1] ?? "")
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
// 此清单比较实际目标源码，不把源 blob 的存在误当作目标迁移完成。
const sharedStyles = ["globals.css", "tokens.css", "shadcn-bridge.css"]
const sharedComponents = [
  "alert",
  "badge",
  "button",
  "card",
  "checkbox",
  "collapsible",
  "command",
  "dialog",
  "dropdown-menu",
  "empty",
  "form",
  "input",
  "label",
  "radio-group",
  "scroll-area",
  "select",
  "separator",
  "sheet",
  "skeleton",
  "slider-captcha",
  "sonner",
  "spinner",
  "switch",
  "table",
  "tabs",
  "textarea",
  "toggle-group",
  "toggle",
  "tooltip",
  "pigcursor-mark",
  "pigcursor-wordmark",
]
const migrationPairs = [
  ...sharedStyles.map((name) => `styles/${name}`),
  ...sharedComponents.map((name) => `components/${name}.tsx`),
].map((source) => ({
  source: `packages/web-ui/src/${source}`,
  target: `packages/web-ui/src/${source.replaceAll("pigcursor-", "pigclaude-")}`,
}))
migrationPairs.push(
  ...["setting-row", "secret-field"].map((name) => ({
    source: `apps/admin/src/components/settings/${name}.tsx`,
    target: `apps/admin/src/components/settings/${name}.tsx`,
  })),
)

migrationPairs.push(
  ...["card", "switch"].map((name) => ({
    source: `apps/admin/src/components/ui/${name}.tsx`,
    target: `apps/admin/src/components/ui/${name}.tsx`,
  })),
)

// 只移除 CSS parser 识别的独立注释节点；选择器、值和字符串内的 token 不做替换。
function removeStandaloneCssComments(node) {
  if (!Array.isArray(node.nodes)) return
  node.nodes = node.nodes.filter((child) => child.type !== "css-comment")
  for (const child of node.nodes) removeStandaloneCssComments(child)
}

const cssEvidencePlugin = {
  parsers: {
    css: {
      ...postcssPlugin.parsers.css,
      async parse(source, options) {
        const ast = await postcssPlugin.parsers.css.parse(source, options)
        removeStandaloneCssComments(ast)
        return ast
      },
    },
  },
}

async function canonicalSource(source, file, transformBrand = false) {
  if (file.endsWith(".css")) {
    return prettier.format(source, {
      parser: "css",
      plugins: [postcssPlugin, cssEvidencePlugin],
    })
  }
  // 仅放行明确的品牌 scope、组件名/路径和隐藏品牌文本替换。
  const branded = transformBrand
    ? source
        .replaceAll("@pigcursor/", "@pigclaude/")
        .replaceAll("Pigcursor", "Pigclaude")
        .replaceAll("pigcursor-wordmark", "pigclaude-wordmark")
        .replaceAll(">pigcursor<", ">pigclaude<")
    : source
  const formatted = await prettier.format(branded, {
    parser: "typescript",
    printWidth: 100,
    semi: false,
    singleQuote: false,
    trailingComma: "all",
    arrowParens: "always",
  })
  const syntax = ts.createSourceFile(
    file,
    formatted,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  return ts.createPrinter({ removeComments: true }).printFile(syntax)
}

// 设置面板必须消费固定来源的 admin 实体，存在同名共享组件不能作为替代。
const settingsFormPath = "apps/admin/src/components/settings/turnstile-settings-form.tsx"
const settingsForm = ts.createSourceFile(
  settingsFormPath,
  await readFile(join(root, settingsFormPath), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
const requiredSettingsImports = new Map([
  ["Card", "@/components/ui/card"],
  ["CardHeader", "@/components/ui/card"],
  ["CardFooter", "@/components/ui/card"],
  ["CardDescription", "@/components/ui/card"],
  ["CardTitle", "@/components/ui/card"],
  ["Switch", "@/components/ui/switch"],
])
for (const statement of settingsForm.statements) {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
  const bindings = statement.importClause?.namedBindings
  if (!bindings || !ts.isNamedImports(bindings)) continue
  for (const item of bindings.elements) {
    const name = item.propertyName?.text ?? item.name.text
    if (requiredSettingsImports.get(name) === statement.moduleSpecifier.text)
      requiredSettingsImports.delete(name)
  }
}
if (requiredSettingsImports.size)
  throw new Error("target migration mismatch: settings must use fixed admin Card/Switch entities")

// Task 7 只额外批准共享会员样式的单条入口引入。
function task7MembershipTransform(source, file) {
  if (file !== "packages/web-ui/src/styles/globals.css") return source
  return source.replace(
    '@import "./shadcn-bridge.css";',
    '@import "./shadcn-bridge.css";\n@import "./membership.css";',
  )
}

// 本任务只批准强调色默认值、landing token 和主按钮安全交互态的精确转换。
// 其余来源 token 和组件结构仍逐字规范化比较，原有负对照继续生效。
function task6AccentTransform(source, file) {
  if (file === "packages/web-ui/src/components/button.tsx") {
    return source.replace(
      "bg-primary text-primary-foreground hover:bg-primary/90",
      "bg-primary text-primary-foreground hover:bg-[var(--btn-primary-hover)] active:bg-[var(--btn-primary-active)]",
    )
  }
  if (file !== "packages/web-ui/src/styles/tokens.css") return source
  return source
    .replaceAll("#2c67c5", "#6352d9")
    .replaceAll("#3a83f7", "#8b7cf6")
    .replaceAll("#1f4e94", "#4c3db8")
    .replace(
      "--accent-glow: #8b7cf6;",
      "--accent-glow: #8b7cf6;\n  --landing-ink-from: #c9c1fd;\n  --landing-ink-to: #8b7cf6;",
    )
    .replace("--btn-primary-hover: var(--accent-hover);", "--btn-primary-hover: var(--accent);")
    .replace(
      "--btn-primary-hover: color-mix(in oklab, var(--accent), black 10%);",
      "--btn-primary-hover: var(--accent);",
    )
    .replace(
      "--accent-ink: var(--accent);",
      "--accent: #6352d9;\n  --accent-on: #ffffff;\n  --accent-hover: #6352d9;\n  --accent-active: #4c3db8;\n  --accent-glow: #8b7cf6;\n  --landing-ink-from: #8b7cf6;\n  --landing-ink-to: #6352d9;\n  --accent-ink: var(--accent);",
    )
}

// 批量读取固定提交的 blob，避免逐组件启动 Git 进程。
const batch = execFileSync("git", ["-C", sourceRoot, "cat-file", "--batch"], {
  input: migrationPairs.map((pair) => `${sourceCommit}:${pair.source}\n`).join(""),
})
let batchOffset = 0
for (const pair of migrationPairs) {
  const headerEnd = batch.indexOf(10, batchOffset)
  const header = batch.subarray(batchOffset, headerEnd).toString("utf8")
  const match = /^\S+ blob (\d+)$/.exec(header)
  if (!match) throw new Error(`source blob unavailable: ${pair.source}: ${header}`)
  const sourceStart = headerEnd + 1
  const sourceEnd = sourceStart + Number(match[1])
  const source = batch.subarray(sourceStart, sourceEnd).toString("utf8")
  batchOffset = sourceEnd + 1
  const target = await readFile(join(root, pair.target), "utf8")
  const sourceCanonical = await canonicalSource(
    task7MembershipTransform(
      task6AccentTransform(await canonicalSource(source, pair.source, true), pair.source),
      pair.source,
    ),
    pair.source,
  )
  const targetCanonical = await canonicalSource(target, pair.target)
  if (sourceCanonical !== targetCanonical) {
    throw new Error(`target migration mismatch: ${pair.source} -> ${pair.target}`)
  }
  const sourceHash = createHash("sha256").update(source).digest("hex")
  const targetHash = createHash("sha256").update(target).digest("hex")
  console.log(
    `shared-source ${pair.source} sha256=${sourceHash} -> ${pair.target} sha256=${targetHash}`,
  )
}
console.log(
  `Source provenance/package boundaries verified for ${expected.join(", ")}; ` +
    `${migrationPairs.length} shared CSS/component source pairs match ${sourceCommit} ` +
    "after documented scope/comment/format transformations. Page appearance and runtime behavior require separate acceptance.",
)
