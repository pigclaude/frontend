// 负责用真实迁移检查器证明目标样式或组件被改动时能够阻止错误的迁移结论。
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { test } from "node:test"

const frontend = resolve(import.meta.dirname, "../..")
const guard = join(frontend, "scripts/assert-pigcursor-migration.mjs")

for (const [file, before, after, shouldPass] of [
  ["styles/tokens.css", "--bg: #08090a", "--bg: #ff0000", false],
  ["components/button.tsx", "inline-flex", "inline-grid", false],
  ["components/button.tsx", "import * as React", "/* 额外中文说明 */\nimport   * as React", true],
]) {
  test(`迁移证据${shouldPass ? "允许注释与格式转换" : `拒绝目标 ${file} 的真实漂移`}`, async () => {
    const target = await mkdtemp(join(tmpdir(), "pigclaude-migration-"))
    try {
      await cp(join(frontend, "packages"), join(target, "packages"), {
        recursive: true,
        filter: (path) => !["node_modules", "dist"].includes(basename(path)),
      })
      await cp(join(frontend, "layout.json"), join(target, "layout.json"))
      const path = join(target, "packages/web-ui/src", file)
      const source = await readFile(path, "utf8")
      assert.ok(source.includes(before), "负对照必须实际改变目标文件")
      await writeFile(path, source.replace(before, after))
      const result = spawnSync(process.execPath, [guard, "--target-root", target], {
        encoding: "utf8",
      })
      if (shouldPass) {
        assert.equal(result.status, 0, result.stderr)
      } else {
        assert.notEqual(result.status, 0, "目标迁移漂移必须被拒绝")
        assert.match(result.stderr, /target migration mismatch/)
      }
    } finally {
      await rm(target, { recursive: true, force: true })
    }
  })
}

test("Vite 配置可在 Node ESM 中读取首帧主题脚本", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { themeInitializationScript } from "@pigclaude/web-ui/lib/theme-initialization";
       globalThis.document = { documentElement: { dataset: {} } };
       globalThis.localStorage = { getItem: () => "light" };
       Function(themeInitializationScript)();
       if (document.documentElement.dataset.theme !== "light") throw new Error("theme not restored");`,
    ],
    { cwd: import.meta.dirname, encoding: "utf8" },
  )
  assert.equal(result.status, 0, result.stderr)
})
