// 在真实 Electron 中从工作台打开合成回环页，核对 Agent 分区、阻断计数和同标签打开。

import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import ts from "typescript"

const require = createRequire(new URL("../../apps/desktop/package.json", import.meta.url))
const temp = await mkdtemp(join(tmpdir(), "pigclaude-native-agent-browser-"))
const files = [
  "agent-browser-network",
  "browser-references",
  "browser-snapshot-world",
  "browser-surface",
]
try {
  for (const file of files) {
    const original = new URL(`../../apps/desktop/src/main/workbench/${file}.ts`, import.meta.url)
    const compiled = ts.transpileModule(await readFile(original, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    })
    await writeFile(join(temp, file + ".js"), compiled.outputText)
  }
  await writeFile(join(temp, "package.json"), '{"type":"commonjs"}')
  await writeFile(
    join(temp, "main.cjs"),
    await readFile(new URL("./agent-browser-probe.cjs", import.meta.url), "utf8"),
  )
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const { stdout } = await promisify(execFile)(
    require("electron"),
    [join(temp, "main.cjs"), ...process.argv.slice(2)],
    {
      timeout: 25_000,
      env,
    },
  )
  process.stdout.write(stdout)
} finally {
  await rm(temp, { recursive: true, force: true })
}
