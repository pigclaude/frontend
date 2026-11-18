// 只读挂载最终 macOS DMG，核对随包固定 PigBrowser 和安装应用的签名。

const { execFile } = require("node:child_process")
const { mkdtemp, readdir, rmdir } = require("node:fs/promises")
const { tmpdir } = require("node:os")
const { basename, join, resolve } = require("node:path")
const { promisify } = require("node:util")
const { verifyPigbrowserPackage } = require("./pigbrowser-resources.cjs")

const run = promisify(execFile)
const target = "darwin-arm64"

/** 只在完成封装的 DMG 中检查资源，验证失败会阻止构建交付。 */
async function verifyMacDmg(artifact, signingRequirement) {
  const mount = await mkdtemp(join(tmpdir(), "pigclaude-verify-dmg-"))
  try {
    await run(
      "/usr/bin/hdiutil",
      ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, resolve(artifact)],
      { timeout: 120_000 },
    )
    try {
      const entries = await readdir(mount, { withFileTypes: true })
      const apps = entries.filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
      if (apps.length !== 1) throw new Error("DMG 必须包含一个实际安装应用")
      const app = join(mount, apps[0].name)
      const resources = join(
        app,
        "Contents",
        "Resources",
        "pigclaude-runtime",
        "pigbrowser",
        target,
      )
      const result = await verifyPigbrowserPackage(resources, target)
      await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], { timeout: 60_000 })
      if (signingRequirement) {
        await run("/usr/bin/codesign", ["--verify", `-R=${signingRequirement}`, app], {
          timeout: 60_000,
        })
      }
      process.stdout.write(
        basename(artifact) + " 已验证 " + result.entries + " 项固定 PigBrowser 资源\n",
      )
    } finally {
      await run("/usr/bin/hdiutil", ["detach", mount], { timeout: 60_000 })
    }
  } finally {
    await rmdir(mount)
  }
}

/** 封装后验证每个 DMG 的资源和签名，可同时校验指定的应用签名要求。 */
module.exports = async function verifyMacDmgArtifacts(result, signingRequirement) {
  for (const artifact of result.artifactPaths.filter((file) => file.endsWith(".dmg"))) {
    await verifyMacDmg(artifact, signingRequirement)
  }
  return []
}

if (require.main === module) {
  const artifact = process.argv[2]
  if (process.argv.length !== 3 || !artifact.endsWith(".dmg")) {
    process.stderr.write("请传入一个最终生成的 macOS DMG\n")
    process.exitCode = 1
  } else {
    void verifyMacDmg(artifact).catch((error) => {
      process.stderr.write(error.message + "\n")
      process.exitCode = 1
    })
  }
}
