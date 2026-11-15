// 负责把 Pigcode 的界面包按固定提交拷入 packages/，并生成来源清单；同步新提交时重跑本脚本。
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import prettier from "prettier"
import {
  contractEntry,
  contractFiles,
  projectScheduleTest,
  projectUiContracts,
} from "./pigcode-ui-contracts.mjs"
import { vendoredPackages } from "./pigcode-package-map.mjs"

const frontend = join(import.meta.dirname, "..")
const lockFile = join(frontend, "pigcode-source.json")

/** client-runtime 只取扩展点注册表；其余是 Host 连接、AppStore 与插件运行时，按规格不拷入。 */
const partialPackages = {
  contracts: [...Object.keys(contractFiles), "src/schedule-rules.ts", "src/schedule-rules.test.ts"],
  "client-runtime": [
    "src/extension-points.tsx",
    "src/extension-points.test.tsx",
    "src/global.d.ts",
    "src/vite-env.d.ts",
  ],
  // 拷入外观、通用页面及定时规则和历史组件。定时任务列表与完整编辑器由 PigClaude 自己实现。
  "ui-settings": [
    "src/appearance-code.tsx",
    "src/appearance-fields.tsx",
    "src/appearance-page.test.tsx",
    "src/appearance-page.tsx",
    "src/appearance-preview.tsx",
    "src/appearance-transfer.tsx",
    "src/choice-select.tsx",
    "src/general-page.test.tsx",
    "src/general-page.tsx",
    "src/global.d.ts",
    "src/preferences.ts",
    "src/schedule-custom-repeat.tsx",
    "src/schedule-format.ts",
    "src/schedule-history.tsx",
    "src/schedule-rule-field.tsx",
    "src/schedule-rule-parts.tsx",
    "src/schedules-page.test.tsx",
    "src/sensitive-text.tsx",
    "src/vite-env.d.ts",
  ],
}

/** 部分拷入的包需要的入口：只导出实际拷入的模块。 */
const partialEntries = {
  contracts: contractEntry,
  "ui-settings": `/** 设置页面和定时任务组件的公开入口。 */
export * from "./appearance-page"
export * from "./general-page"
export { CustomRepeatDialog } from "./schedule-custom-repeat"
export { DEFAULT_RULE, formatRule } from "./schedule-format"
export { ScheduleHistory, type ScheduleRunsPage } from "./schedule-history"
export { ScheduleRuleField, type RuleValue } from "./schedule-rule-field"
export { MinutePill, Preview, TimePills, TimeZone } from "./schedule-rule-parts"
`,
}

// 定时任务的上游测试同时覆盖 Host 和整页 UI，从中保留本次同步范围内的测试组。
const scheduleTests = {
  "packages/contracts/src/schedule-rules.test.ts": {
    target: "src/schedule-rules.test.ts",
    suite: "nextScheduleRun",
    helpers: ["at", "next"],
  },
  "packages/ui-settings/src/schedules-page.test.tsx": {
    target: "src/schedule-format.test.ts",
    suite: "formatRule",
  },
}

/** 点分的本地存储键（侧栏宽度、侧栏排法等）改用 PigClaude 的前缀；主题文件格式与主题代码前缀不在此列。 */
const storageKey = /"pigcode\.([A-Za-z]+)"/g

/**
 * 产品名只在已接入的语言包及其断言测试，以及写死产品名的顶栏更新中心里替换；
 * 其他来源文件保持 Pigcode 原文。
 */
export const productNameFiles = new Set([
  "src/locale/messages.zh-CN.ts",
  "src/locale/messages.en-US.ts",
  "src/locale/new-thread.messages.ts",
  "src/add-project-dialog.test.tsx",
  "src/update-center.tsx",
])

/**
 * 允许的机械替换：包名、点分的本地存储键前缀、登记的语言包里的产品名。不改任何逻辑或样式。
 * rest 是文件在包内的路径，用来判断要不要替换产品名。
 */
export function rewriteSource(text, rest = "") {
  let next = text
  for (const item of vendoredPackages) {
    next = next.replaceAll(`@pigcode/${item.source}`, item.name)
  }
  next = next.replace(storageKey, '"pigclaude.$1"')
  if (productNameFiles.has(rest)) next = next.replaceAll("Pigcode", "PigClaude")
  if (rest === "src/theme/theme-presets.ts") {
    next = next.replace('name: "pigcode"', 'name: "PigClaude"')
  }
  if (rest === "src/theme/appearance-storage.ts") {
    next = next.replace('"pigcode-appearance"', '"pigclaude-appearance-v2"')
    next = next.replace('"pigcode-themes"', '"pigclaude-themes-v2"')
    next = next.replace('"pigcode-theme"', '"pigclaude-theme"')
  }
  if (rest === "src/theme/theme-import.test.ts") {
    next = next.replaceAll("pigcode + Nord", "PigClaude + Nord")
    next = next.replaceAll("pigcode-nord.pigcode-theme.json", "pigclaude-nord.pigcode-theme.json")
  }
  // 两种客户端的主题文件共用同一字段结构，导出仍用 Pigcode 格式。
  if (rest === "src/theme/theme-file.ts") {
    next = next.replace(
      "data.schema !== SCHEMA",
      '(data.schema !== SCHEMA && data.schema !== "pigclaude-theme/1")',
    )
  }
  return next
}

/** ui-shell 另外导出的模块：PigClaude 用它们组合自己的外壳（侧栏分隔条、侧栏滚动区、标题栏菜单）。 */
export const shellSubpathExports = {
  "./panel-resizer": "./src/panel-resizer.tsx",
  "./side-scroll": "./src/side-scroll.tsx",
  "./title-bar-menus": "./src/title-bar-menus.ts",
}

/** 计算文件内容的 SHA256，清单与守卫共用这一种算法。 */
export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 256 << 20 })
}

async function vendor(repo, commit) {
  const resolved = git(repo, "rev-parse", `${commit}^{commit}`).toString().trim()
  const listed = git(repo, "ls-tree", "-r", "--name-only", resolved, "packages").toString()
  const tree = new Set(listed.split("\n").filter(Boolean))
  const files = []
  const outputs = new Map()
  const format = await prettier.resolveConfig(join(frontend, "package.json"))
  for (const item of vendoredPackages) {
    const prefix = `packages/${item.source}/`
    const only = partialPackages[item.source]
    const required = ["package.json", "tsconfig.json", ...(only ?? ["src/index.ts"])]
    const missing = required.filter((path) => !tree.has(prefix + path))
    if (missing.length > 0) {
      throw new Error(
        `Pigcode ${resolved.slice(0, 7)} 缺少 ${missing.map((path) => prefix + path).join(", ")}`,
      )
    }
    const wanted = [...tree].filter((path) => {
      if (!path.startsWith(prefix)) return false
      const rest = path.slice(prefix.length)
      if (rest === "package.json" || rest === "tsconfig.json") return true
      if (!rest.startsWith("src/")) return false
      return only ? only.includes(rest) : true
    })
    const entry = partialEntries[item.source]
    if (entry) {
      const destination = `packages/${item.target}/src/index.ts`
      const output = await prettier.format(entry, { ...format, filepath: "index.ts" })
      outputs.set(destination, output)
      files.push({
        path: destination,
        source: null,
        sourceSha256: null,
        sha256: sha256(output),
      })
    }
    for (const path of wanted.sort()) {
      const rest = path.slice(prefix.length)
      const original = git(repo, "show", `${resolved}:${path}`)
      const isText = /\.(tsx?|css|json|md|svg)$/.test(rest)
      let output = isText ? rewriteSource(original.toString("utf8"), rest) : original
      const contractPath = item.source === "contracts" ? contractFiles[rest] : undefined
      if (contractPath) output = projectUiContracts(output, rest)
      const test = scheduleTests[path]
      if (test) output = projectScheduleTest(output, rest, test.suite, test.helpers)
      if (rest === "package.json") output = rewriteManifest(output, item)
      if (rest === "tsconfig.json") output = rewriteTsconfig(output)
      // 改名后部分行超出 100 列：按本仓库 Prettier 配置重排，守卫记录的是重排后的内容。
      if (/\.(tsx?|json|css)$/.test(rest)) {
        output = await prettier.format(output, { ...format, filepath: rest })
      }
      const destination = `packages/${item.target}/${contractPath ?? test?.target ?? rest}`
      outputs.set(destination, output)
      files.push({
        path: destination,
        source: path,
        sourceSha256: sha256(original),
        sha256: sha256(output),
      })
    }
  }
  // 先确认全部源文件可生成，再清掉旧内容。保留工作区依赖链接。
  for (const { target } of vendoredPackages) {
    for (const name of ["src", "package.json", "tsconfig.json"]) {
      await rm(join(frontend, "packages", target, name), { recursive: true, force: true })
    }
  }
  for (const [path, output] of outputs) {
    const destination = join(frontend, path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, output)
  }
  const lock = {
    repository: "pigcode/pigcode",
    commit: resolved,
    rule: '@pigcode/contracts → @pigclaude/ui-contracts，选取声明和纯函数；定时规则测试选取已拷入功能的测试组；其余 @pigcode/<package> → @pigclaude/<package>；"pigcode.<key>" 存储键 → "pigclaude.<key>"；登记的文案和默认主题显示名改为 PigClaude；主题文件解析同时接受旧 schema；package.json 与 tsconfig.json 另按 rewriteManifest / rewriteTsconfig 调整；最后按本仓库 Prettier 配置重排',
    files,
  }
  await writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`)
  return lock
}

/** 本仓库各包独立安装测试依赖（Pigcode 把它们放在工作区根目录），版本与 Pigcode 根清单一致。 */
const testDependencies = {
  "@testing-library/dom": "10.4.1",
  "@testing-library/react": "16.3.0",
  "@testing-library/user-event": "14.6.1",
  "@types/node": "24.10.1",
  "@types/react": "19.2.2",
  "@types/react-dom": "19.2.2",
  jsdom: "26.1.0",
  react: "19.2.3",
  "react-dom": "19.2.3",
  typescript: "5.9.3",
  vitest: "4.0.16",
}

/** 包清单：改名、去掉 client-runtime 不再需要的依赖、给需要 DOM 的包补测试依赖。 */
export function rewriteManifest(text, item) {
  const manifest = JSON.parse(rewriteSource(text))
  manifest.name = item.name
  manifest.version = "0.0.0"
  manifest.private = true
  if (item.source === "client-runtime") {
    manifest.exports = { ".": "./src/extension-points.tsx" }
    delete manifest.dependencies["@pigcode/plugin-sdk"]
    delete manifest.dependencies["@pigclaude/ui-contracts"]
  }
  if (item.source === "ui-shell") {
    manifest.exports = { ...manifest.exports, ...shellSubpathExports }
  }
  if (item.source === "ui-workbench") {
    manifest.exports = { ...manifest.exports, "./terminal-view": "./src/terminal-view.tsx" }
  }
  manifest.scripts = {
    typecheck: "tsc --noEmit",
    test: "vitest run --passWithNoTests --config ../../vitest.pigcode.config.ts",
  }
  manifest.devDependencies = { ...(manifest.devDependencies ?? {}), ...testDependencies }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/** tsconfig 继承本仓库的 Pigcode 严格配置，不引用 Pigcode 仓库根目录。 */
export function rewriteTsconfig(text) {
  const config = JSON.parse(text)
  config.extends = "../../tsconfig.pigcode.json"
  return `${JSON.stringify(config, null, 2)}\n`
}

if (import.meta.main) {
  const repo = process.argv[2]
  const commit = process.argv[3]
  if (!repo || !commit) {
    console.error("usage: node scripts/vendor-pigcode.mjs <pigcode-frontend-repo> <commit>")
    process.exit(2)
  }
  const lock = await vendor(repo, commit)
  console.log(`vendored ${lock.files.length} files from ${lock.commit}`)
}
