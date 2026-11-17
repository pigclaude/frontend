// 在 macOS 资源复制完成后恢复固定 PigBrowser 包根目录的权限，并校验暂存内容。

const { chmod, lstat } = require("node:fs/promises")
const { join } = require("node:path")
const { verifyPigbrowserPackage } = require("./pigbrowser-resources.cjs")

/** 让 macOS 签名前的暂存资源符合已通过打包前校验的固定清单。 */
module.exports = async function preserveMacPigbrowserResources(context) {
  if (context.electronPlatformName !== "darwin") return

  const target = "darwin-arm64"
  const relativePackage = join("pigclaude-runtime", "pigbrowser", target)
  const source = join(context.packager.projectDir, "runtime-assets", relativePackage)
  const destination = join(context.packager.getResourcesDir(context.appOutDir), relativePackage)

  // 通用资源复制器会重新创建目录，导致包根目录使用默认权限。
  await chmod(destination, (await lstat(source)).mode & 0o777)
  await verifyPigbrowserPackage(destination, target)
}
