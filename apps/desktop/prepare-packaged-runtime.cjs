// 在封装前校验 PigBrowser，并准备 Linux 的 AppImage 沙箱入口与原生 CLI 语言库。

const { execFile } = require("node:child_process")
const { access, chmod, copyFile, rename, symlink } = require("node:fs/promises")
const { join } = require("node:path")
const { promisify } = require("node:util")
const preparePackagedPigbrowser = require("./prepare-packaged-pigbrowser.cjs")
const { linuxSystemSandboxLink } = require("./pigbrowser-resources.cjs")

const run = promisify(execFile)

/** AppImage 使用系统沙箱助手并保留官方 CLI 可执行文件。 */
module.exports = async function preparePackagedRuntime(context) {
  await preparePackagedPigbrowser(context)
  if (context.electronPlatformName !== "linux") return

  if (context.targets.some(({ name }) => name === "appImage")) {
    const launcher = join(context.appOutDir, "AppRun")
    const sandbox = join(context.appOutDir, "chrome-sandbox")
    const link = sandbox + ".system-link"
    // electron-builder 把 appOutDir 覆盖到 AppImage 的暂存目录，采用这里的入口。
    await copyFile(join(__dirname, "linux-appimage-entry.sh"), launcher)
    await chmod(launcher, 0o755)
    // AppImage 的 FUSE 挂载为 nosuid，实际 SUID 助手必须来自宿主系统。
    await symlink(linuxSystemSandboxLink.target, link)
    await rename(link, sandbox)
  }

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
