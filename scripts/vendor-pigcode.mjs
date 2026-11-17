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
import { projectPluginManagerSlots } from "./pigcode-plugin-manager.mjs"
import { projectSchedules } from "./pigcode-schedules.mjs"

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
  // 拷入外观、通用页面和定时任务；本机调度由桌面适配层接入。
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
    "src/schedule-composer.tsx",
    "src/schedule-confirm-dialog.tsx",
    "src/schedule-editor.tsx",
    "src/schedule-format.ts",
    "src/schedule-history.tsx",
    "src/schedule-rule-field.tsx",
    "src/schedule-rule-parts.tsx",
    "src/schedule-types.ts",
    "src/schedules-page.tsx",
    "src/schedules-page.test.tsx",
    "src/sensitive-text.tsx",
    "src/vite-env.d.ts",
  ],
  // 安装表单已在 ui-primitives，仅同步列表、详情及其摘要和类型声明。
  "ui-plugin-manager": [
    "src/global.d.ts",
    "src/plugin-details.tsx",
    "src/plugin-list.tsx",
    "src/plugin-summary.ts",
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
export { SchedulesPage } from "./schedules-page"
export type { CreateScheduleInput, RunNowResult, ScheduleAgentOptions, ScheduleComposerSources, ScheduleWorkspaceControlsProps, UpdateScheduleInput } from "./schedules-page"
`,
  "ui-plugin-manager": `/** 已安装插件的列表、详情与展示数据。 */
export { PluginDetailsDialog } from "./plugin-details"
export { PluginList } from "./plugin-list"
export type { PluginSummary } from "./plugin-summary"
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
  "src/locale/schedules.messages.ts",
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

// 通用角标只负责显示。标签由桌面适配层提供，会话标题、重命名和其他操作使用原数据。
function addThreadLabelSlot(source) {
  const edits = [
    [
      "  threadStatus?: Record<string, ThreadStatus> | undefined\n",
      "  threadStatus?: Record<string, ThreadStatus> | undefined\n" +
        "  /** 按会话 ID 提供额外的只读行标签。 */\n" +
        "  threadLabels?: Readonly<Record<string, string>> | undefined\n",
    ],
    ["  threadStatus = {},\n", "  threadStatus = {},\n  threadLabels,\n"],
    [
      "  const row = (thread: Thread, detail: ReactNode) => {\n",
      "  const row = (thread: Thread, detail: ReactNode) => {\n" +
        "    const label = threadLabels?.[thread.id]\n",
    ],
    [
      "        detail={detail}",
      '        detail={label ? <><span className="sess-agent">{label}</span>{detail}</> : detail}',
    ],
  ]
  for (const [before, after] of edits) {
    if (!source.includes(before)) throw new Error("Pigcode 会话行插槽源位置已变动")
    source = source.replace(before, after)
  }
  return source
}

// 通用状态槽由宿主提供内容，放在原生页面的工具栏里。
const browserToolbarSlots = {
  "src/browser-view.tsx": [
    [
      "  openExternal?: PreviewOpen\n",
      "  openExternal?: PreviewOpen\n  /** 工具栏上的宿主状态内容。 */\n  toolbarStatus?: ReactNode\n",
    ],
    ["  slot,\n}: BrowserViewProps)", "  toolbarStatus,\n  slot,\n}: BrowserViewProps)"],
    [
      "        onInvalid={setError}\n",
      "        onInvalid={setError}\n        toolbarStatus={toolbarStatus}\n",
    ],
  ],
  "src/browser-toolbar.tsx": [
    [
      "  onInvalid: (message: string | null) => void\n",
      "  onInvalid: (message: string | null) => void\n  toolbarStatus?: ReactNode\n",
    ],
    [
      "  onInvalid,\n}: BrowserToolbarProps)",
      "  onInvalid,\n  toolbarStatus,\n}: BrowserToolbarProps)",
    ],
    [
      "      </Menu.Root>\n      {loading ?",
      "      </Menu.Root>\n      {toolbarStatus}\n      {loading ?",
    ],
  ],
}

function projectBrowserToolbarSlot(source, path) {
  for (const [before, after] of browserToolbarSlots[path] ?? []) {
    const at = source.indexOf(before)
    if (at < 0 || source.indexOf(before, at + before.length) >= 0)
      throw new Error(`Pigcode 浏览器工具栏插槽源位置已变动：${path}`)
    source = source.replace(before, after)
  }
  return source
}

// 个人和项目技能也能从 / 菜单查找；中文输入法的人民币符号可打开专用技能菜单。
function projectSkillSuggestionTriggers(source) {
  const edits = [
    ["  exitSuggestion,\n", "  exitSuggestion,\n  findSuggestionMatch,\n"],
    [
      '          char: "$",\n          pluginKey: SKILL_SUGGESTION_KEY,\n',
      '          char: "$",\n          pluginKey: SKILL_SUGGESTION_KEY,\n' +
        "          findSuggestionMatch: (options) => {\n" +
        '            for (const char of "$¥￥") {\n' +
        "              const match = findSuggestionMatch({ ...options, char })\n" +
        "              if (match) return match\n" +
        "            }\n" +
        "            return null\n" +
        "          },\n",
    ],
    [
      '            const all = firstPerLabel([\n              ...availableCommands(),\n              ...ordered(agentListed.filter((command) => !command.insert?.startsWith("$"))),\n            ])\n            return commandItems(all, query)',
      '            const skills = searchSkills(agentListed, "").filter((command) => skillScope(command))\n' +
        "            const skillsById = new Map(skills.map((skill) => [skill.id, skill]))\n" +
        '            const nativeCommands = new Set(skills.map(({ skill }) => "/" + skill?.name.toLowerCase()))\n' +
        "            const entries = agentListed.filter((command) =>\n" +
        '              skillsById.has(command.id) || (!command.insert?.startsWith("$") &&\n' +
        '                (command.source !== "skill" || !nativeCommands.has(command.label.toLowerCase()))),\n' +
        "            )\n" +
        "            const all = firstPerLabel([...availableCommands(), ...ordered(entries)])\n" +
        "            const requestedSkill = /^skill(?::(.*))?$/i.exec(query.trim())\n" +
        '            const matches = requestedSkill ? searchSkills(skills, requestedSkill[1] ?? "") : searchCommands(all, query)\n' +
        '            return commandItems(matches, "").map((item) => {\n' +
        "              const skill = skillsById.get(item.id)\n" +
        '              return skill ? { ...item, label: "/skill:" + skillLabel(skill), scope: skillScope(skill) } : item\n' +
        "            })",
    ],
  ]
  for (const [before, after] of edits) {
    const at = source.indexOf(before)
    if (at < 0 || source.indexOf(before, at + before.length) >= 0)
      throw new Error("Pigcode Skill 输入触发位置已变动")
    source = source.replace(before, after)
  }
  return source
}

// 有明确用户作用域的 Claude 插件技能在建议里显示为「个人」。
function projectPersonalSkillScope(source) {
  const before = "  if (!skill) return undefined\n"
  const personal = '  if (["user", "personal"].includes(skill.scope ?? "")) return "user"\n'
  const pluginId = "    skill.pluginId ||\n"
  if (!source.includes(before) || !source.includes(personal) || !source.includes(pluginId))
    throw new Error("Pigcode Skill 作用域位置已变动")
  return source
    .replace(personal, "")
    .replace(pluginId, "")
    .replace(before, before + '  if (skill.pluginId) return "plugin"\n' + personal)
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
      if (path === "packages/ui-shell/src/workspace-sidebar.tsx")
        output = addThreadLabelSlot(output)
      if (item.source === "ui-plugin-manager") output = projectPluginManagerSlots(output, rest)
      if (item.source === "ui-settings") output = projectSchedules(output, rest)
      if (item.source === "ui-workbench") output = projectBrowserToolbarSlot(output, rest)
      if (
        path === "packages/ui-composer/src/composer-editor.ts" &&
        output.includes("SKILL_SUGGESTION_KEY")
      )
        output = projectSkillSuggestionTriggers(output)
      if (path === "packages/ui-composer/src/skill-search.ts")
        output = projectPersonalSkillScope(output)
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
    rule: '@pigcode/contracts → @pigclaude/ui-contracts，选取声明和纯函数；定时规则测试选取已拷入功能的测试组；工作区侧栏增加通用会话角标槽；浏览器工具栏增加通用状态槽；Skill 菜单接受中文输入法的人民币符号，/ 菜单增加带来源的技能项；插件列表和详情增加类型标签、详情内容、启停可用性和卸载选项插槽；其余 @pigcode/<package> → @pigclaude/<package>；"pigcode.<key>" 存储键 → "pigclaude.<key>"；登记的文案和默认主题显示名改为 PigClaude；主题文件解析同时接受旧 schema；package.json 与 tsconfig.json 另按 rewriteManifest / rewriteTsconfig 调整；最后按本仓库 Prettier 配置重排',
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
