// 负责扫描主题色使用范围中的旧蓝色常量，精确区分预设兼容表与测试夹具。
import { readFile, readdir } from "node:fs/promises"
import { join, relative } from "node:path"

const root = join(import.meta.dirname, "..")
const roots = ["apps/home/src", "apps/admin/src", "packages/web-ui/src"]
// 应用入口 HTML 不在 src 下，单独列出。
const entries = ["apps/admin/index.html"]
// 只豁免精确保留的旧蓝预设和测试，不整体豁免会员卡面或渠道模块。
// 当前卡面与渠道品牌没有命中此旧蓝色，未来新增豁免必须限定具体文件与用途。
const exemptions = new Map([["packages/web-ui/src/lib/accent-presets.ts", "按约定保留旧蓝预设"]])
// 旧蓝的品牌色、按钮底色、按压色、官网渐变起点，以及旧光晕的 RGB 写法。
const legacy = /#(?:3a83f7|2c67c5|1f4e94|a9cffb)\b|58,\s*131,\s*247/gi
const unexpected = []
let exemptCount = 0
async function check(path) {
  const name = relative(root, path).replaceAll("\\", "/")
  const lines = (await readFile(path, "utf8")).split("\n")
  for (const [index, line] of lines.entries()) {
    legacy.lastIndex = 0
    if (!legacy.test(line)) continue
    if (exemptions.has(name) || /\.test\.tsx?$/.test(name)) exemptCount++
    else unexpected.push(`${name}:${index + 1}: ${line.trim()}`)
  }
}
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await scan(path)
    else if (/\.(?:ts|tsx|css|html|mjs)$/.test(path)) await check(path)
  }
}
for (const dir of roots) await scan(join(root, dir))
for (const file of entries) await check(join(root, file))
if (unexpected.length) {
  console.error(unexpected.join("\n"))
  process.exitCode = 1
} else console.log(`主题色旧蓝扫描通过：0 个非豁免命中，${exemptCount} 行精确预设或测试豁免。`)
