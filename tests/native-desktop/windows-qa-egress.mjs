// 编译候选代码和真实插件预加载，在临时目录记录两端的 TCP 接入情况。
import { execFile } from "node:child_process"
import { copyFile, mkdir, writeFile } from "node:fs/promises"
import { createRequire, isBuiltin } from "node:module"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const desktop = join(root, "apps", "desktop")
const requireDesktop = createRequire(join(desktop, "package.json"))
const { build } = await import(pathToFileURL(requireDesktop.resolve("vite")).href)
const scratch = join(process.env.RUNNER_TEMP, "synthetic-egress")
await mkdir(scratch)
await mkdir(join(scratch, "profile"))
for (const [entry, output] of [
  [fileURLToPath(new URL("./windows-qa-egress-probe.ts", import.meta.url)), "egress.cjs"],
  [join(desktop, "src", "preload", "plugin-sandbox.ts"), "plugin-preload.js"],
]) {
  await build({
    configFile: false,
    logLevel: "error",
    build: {
      target: "node22", minify: false, outDir: scratch, emptyOutDir: false,
      lib: { entry, formats: ["cjs"], fileName: () => output },
      rollupOptions: { external: (name) => name === "electron" || isBuiltin(name) },
    },
  })
}
const certDir = join(root, "packages", "login-gate", "src", "test-fixtures")
await copyFile(join(certDir, "localhost-synthetic-cert.pem"), join(scratch, "fixture-cert.pem"))
await copyFile(join(certDir, "localhost-synthetic-key.pem"), join(scratch, "fixture-key.pem"))
await writeFile(join(scratch, "capture-ready"), "ready\n")
const exec = promisify(execFile)
const evidence = resolve(process.argv[2])
await mkdir(evidence, { recursive: true })
try {
  const { stdout, stderr } = await exec(requireDesktop("electron"), [join(scratch, "egress.cjs")], {
    cwd: scratch, timeout: 105000, windowsHide: true,
    env: { ...process.env, PIGCLAUDE_EGRESS_QA: "1" },
  })
  process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
  await copyFile(join(scratch, "egress-result.json"), join(evidence, "windows-plugin-egress.json"))
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout)
  if (error.stderr) process.stderr.write(error.stderr)
  throw error
}
