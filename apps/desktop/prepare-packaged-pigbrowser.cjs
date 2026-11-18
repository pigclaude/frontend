// 在平台封装前准备 PigBrowser 资源，并核对暂存内容。

const { chmod, lstat, symlink } = require("node:fs/promises")
const { join } = require("node:path")
const { linuxSystemSandboxLink, verifyPigbrowserPackage } = require("./pigbrowser-resources.cjs")

/** 恢复 macOS 包根目录权限，给 Linux 内核接入系统 Chrome 的沙箱助手。 */
module.exports = async function preparePackagedPigbrowser(context) {
  const platform = context.electronPlatformName
  if (platform !== "darwin" && platform !== "linux") return

  const target = platform === "linux" ? "linux-x64" : "darwin-arm64"
  const relativePackage = join("pigclaude-runtime", "pigbrowser", target)
  const destination = join(context.packager.getResourcesDir(context.appOutDir), relativePackage)

  if (platform === "linux") {
    await symlink(linuxSystemSandboxLink.target, join(destination, linuxSystemSandboxLink.path))
  } else {
    const source = join(context.packager.projectDir, "runtime-assets", relativePackage)
    // 通用资源复制器会重新创建目录，导致包根目录使用默认权限。
    await chmod(destination, (await lstat(source)).mode & 0o777)
  }
  await verifyPigbrowserPackage(destination, target, {
    allowLinuxSandboxLink: platform === "linux",
  })
}
