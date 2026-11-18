// 在封装前校验 PigBrowser，并在 Linux 官方 CLI 旁构建本地语言初始化库。

const { execFile } = require("node:child_process")
const { access } = require("node:fs/promises")
const { join } = require("node:path")
const { promisify } = require("node:util")
const preparePackagedPigbrowser = require("./prepare-packaged-pigbrowser.cjs")

const run = promisify(execFile)

/** 只在 Linux 打包时构建随包 CLI 的初始化库，保留原始官方可执行文件。 */
module.exports = async function preparePackagedRuntime(context) {
  await preparePackagedPigbrowser(context)
  if (context.electronPlatformName !== "linux") return

  const directory = join(
    context.packager.getResourcesDir(context.appOutDir),
    "app.asar.unpacked",
    "node_modules",
    "@anthropic-ai",
    "claude-agent-sdk-linux-x64",
  )
  await access(join(directory, "claude"))
  await run(
    "cc",
    [
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-fPIC",
      "-shared",
      join(__dirname, "linux-claude-locale.c"),
      "-o",
      join(directory, "pigclaude-cli-locale.so"),
    ],
    { timeout: 30_000 },
  )
}
