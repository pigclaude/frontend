// 负责证明 Pigcode 来源守卫的判定：原样拷入通过，直接改拷入文件、多出清单外文件、删掉清单内文件都失败；
// 以及同步时只做登记过的替换：包名、点分存储键前缀、主语言包里的产品名。
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cp, mkdtemp, readFile, rm, writeFile, appendFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { rewriteSource } from "../scripts/vendor-pigcode.mjs"

const frontend = join(import.meta.dirname, "..")
const guard = join(frontend, "scripts/assert-pigcode-source.mjs")
const lock = JSON.parse(await readFile(join(frontend, "pigcode-source.json"), "utf8"))
const packages = [...new Set(lock.files.map((file) => file.path.split("/").slice(0, 2).join("/")))]

/** 在临时目录里复制清单与拷入的包（不含 node_modules），再对它运行守卫。 */
async function run(mutate) {
  const root = await mkdtemp(join(tmpdir(), "pigcode-source-guard-"))
  try {
    await cp(join(frontend, "pigcode-source.json"), join(root, "pigcode-source.json"))
    for (const pkg of packages) {
      await cp(join(frontend, pkg), join(root, pkg), {
        recursive: true,
        filter: (source) => !source.includes("node_modules"),
      })
    }
    await mutate(root)
    return spawnSync(process.execPath, [guard, "--root", root], { encoding: "utf8" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const sample = lock.files.find((file) => file.path.endsWith("/src/styles/tokens.css"))

test("原样拷入的 Pigcode 代码通过", async () => {
  const result = await run(async () => undefined)
  assert.equal(result.status, 0, result.stderr)
})

test("直接修改拷入文件失败", async () => {
  assert.ok(sample)
  const result = await run((root) => appendFile(join(root, sample.path), "\n/* 本地改动 */\n"))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /content differs from Pigcode/)
})

test("拷入目录里多出清单外的文件失败", async () => {
  const result = await run((root) =>
    writeFile(join(root, packages[0], "src/extra.ts"), "// 额外\n"),
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /not in pigcode-source.json/)
})

test("删掉清单内的文件失败", async () => {
  assert.ok(sample)
  const result = await run((root) => rm(join(root, sample.path)))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /missing/)
})

test("同步只替换包名与点分存储键，主题文件格式和主题代码前缀保持 Pigcode 的写法", () => {
  const source = [
    'import { Button } from "@pigcode/ui-primitives"',
    'const KEY = "pigcode.sidebarWidth"',
    'const SCHEMA = "pigcode-theme/1"',
    'export const themeCodePrefix = "pigcode-theme-v1:"',
    '  "menu.about": "关于 Pigcode",',
  ].join("\n")
  assert.equal(
    rewriteSource(source, "src/panel-resizer.tsx"),
    [
      'import { Button } from "@pigclaude/pigcode-ui-primitives"',
      'const KEY = "pigclaude.sidebarWidth"',
      'const SCHEMA = "pigcode-theme/1"',
      'export const themeCodePrefix = "pigcode-theme-v1:"',
      '  "menu.about": "关于 Pigcode",',
    ].join("\n"),
  )
})

test("产品名只在登记的主语言包里替换", () => {
  const text = '  "menu.about": "关于 Pigcode",\n  "plugins.creator.guide": "Pigcode 插件创建指南",'
  assert.equal(
    rewriteSource(text, "src/locale/messages.zh-CN.ts"),
    '  "menu.about": "关于 PigClaude",\n  "plugins.creator.guide": "PigClaude 插件创建指南",',
  )
  assert.equal(rewriteSource(text, "src/locale/plugins.messages.ts"), text)
})

test("固定提交不是完整 SHA 时失败", async () => {
  const result = await run(async (root) => {
    const file = join(root, "pigcode-source.json")
    const value = JSON.parse(await readFile(file, "utf8"))
    value.commit = value.commit.slice(0, 7)
    await writeFile(file, JSON.stringify(value))
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /full 40-character SHA/)
})
