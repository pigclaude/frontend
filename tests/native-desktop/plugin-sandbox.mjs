// 编译并运行只使用合成能力插件的 Electron 探针，同时验证 Linux 无沙箱启动拒绝加载。
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"

const desktop = fileURLToPath(new URL("../../apps/desktop/", import.meta.url))
const requireDesktop = createRequire(join(desktop, "package.json"))
const electron = requireDesktop("electron")
const { build } = await import(pathToFileURL(requireDesktop.resolve("vite")).href)
const exec = promisify(execFile)
const directory = await mkdtemp(join(tmpdir(), "pigclaude-plugin-sandbox-"))

try {
  await build({
    configFile: false,
    logLevel: "error",
    build: {
      target: "node22",
      minify: false,
      outDir: directory,
      emptyOutDir: false,
      lib: {
        entry: fileURLToPath(new URL("./plugin-sandbox-probe.ts", import.meta.url)),
        formats: ["cjs"],
        fileName: () => "probe.cjs",
      },
      rollupOptions: { external: (id) => id === "electron" || id.startsWith("node:") },
    },
  })
  await run(false)
  if (process.platform === "linux") await run(true)
} finally {
  await rm(directory, { recursive: true, force: true })
}

async function run(noSandbox) {
  const data = join(directory, noSandbox ? "blocked" : "sandboxed")
  await mkdir(data)
  const { stdout, stderr } = await exec(
    electron,
    [...(noSandbox ? ["--no-sandbox"] : []), join(directory, "probe.cjs")],
    {
      timeout: 45_000,
      env: {
        ...process.env,
        PIGCLAUDE_PROBE_PROFILE: data,
        PIGCLAUDE_PROBE_PRELOAD: join(desktop, "out", "preload", "plugin-sandbox.js"),
        PIGCLAUDE_PROBE_SANDBOX_DISABLED: noSandbox ? "1" : "0",
      },
    },
  ).catch((error) => {
    if (error.stdout) process.stderr.write(error.stdout)
    if (error.stderr) process.stderr.write(error.stderr)
    throw error
  })
  process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
}
