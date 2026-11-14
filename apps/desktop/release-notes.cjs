// 负责生成发布说明：版本、三平台安装包和 sha256、随包内核的实际状态，以及不签名带来的已知限制。

const { createHash } = require("node:crypto")
const { readFileSync, readdirSync } = require("node:fs")
const { join } = require("node:path")

const INSTALLERS = [
  { suffix: ".dmg", platform: "macOS（Apple 芯片）" },
  { suffix: ".exe", platform: "Windows x64" },
  { suffix: ".AppImage", platform: "Linux x64" },
]

/** 列出目录里三个平台的安装包和各自的 sha256；缺少任何一个平台时报错。 */
function installerDigests(directory) {
  const names = readdirSync(directory)
  return INSTALLERS.map(({ suffix, platform }) => {
    const name = names.find((candidate) => candidate.endsWith(suffix))
    if (!name) throw new Error(`缺少 ${platform} 安装包`)
    const digest = createHash("sha256")
      .update(readFileSync(join(directory, name)))
      .digest("hex")
    return { platform, name, sha256: digest }
  })
}

/** 生成发布说明的 Markdown。测试发布在开头标明不是正式版本。 */
function releaseNotes({ version, test, installers, pigbrowserVersion }) {
  const rows = installers.map(
    (item) => `| ${item.platform} | \`${item.name}\` | \`${item.sha256}\` |`,
  )
  return [
    ...(test ? ["> **测试发布**：只用于验证发布流程，不是正式版本，请不要下载使用。", ""] : []),
    `PigClaude ${version}`,
    "",
    "| 平台 | 安装包 | sha256 |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "更新清单 `latest-mac.yml`、`latest.yml`、`latest-linux.yml` 里有每个文件的 sha512，应用检查更新时用它们校验下载的安装包。",
    "",
    "## 随包内核",
    "",
    `三个平台都带 PigBrowser ${pigbrowserVersion} 和 Xray。PigBrowser 是固定的集成用开发包（见 frontend 的 \`apps/desktop/pigbrowser-artifacts.json\`），正式版内核和安装态验收另行完成。内置的 Claude Code 和内核随整个安装包更新。`,
    "",
    "## 已知限制",
    "",
    "三个平台的安装包都没有代码签名：",
    "",
    "- macOS 不能自动安装更新：应用下载并校验新版本后，提示你打开安装包、退出应用，再把新版本拖进「应用程序」。第一次打开时要在「系统设置 → 隐私与安全性」里允许。",
    "- macOS 的系统通知可能发不出来。",
    "- 更新后 macOS 钥匙串可能要求重新授权；拒绝时，本机加密保存的授权数据读不出来，需要重新登录。",
    "- Windows 首次安装和更新时 SmartScreen 会提示，选择「仍要运行」。",
    "",
  ].join("\n")
}

module.exports = { installerDigests, releaseNotes }

if (require.main === module) {
  const [directory, version, test] = process.argv.slice(2)
  const artifacts = JSON.parse(readFileSync(join(__dirname, "pigbrowser-artifacts.json"), "utf8"))
  process.stdout.write(
    releaseNotes({
      version,
      test: test === "true",
      installers: installerDigests(directory),
      pigbrowserVersion: artifacts.version,
    }),
  )
}
