// 用固定 Developer ID 团队打 macOS 测试包，并在最终 DMG 校验签名身份。

const { appId } = require("./electron-builder.json")
const verifyMacDmgArtifacts = require("./verify-macos-dmg-resources.cjs")

/** 保留正式包的应用标识，保证启用签名时不会退回临时签名。 */
module.exports = function macosSignedConfig() {
  const teamId = process.env.PIGCLAUDE_MAC_TEAM_ID?.trim() ?? ""
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error("请设置有效的 PIGCLAUDE_MAC_TEAM_ID")

  const requirement = [
    `identifier "${appId}"`,
    "anchor apple generic",
    "certificate 1[field.1.2.840.113635.100.6.2.6] exists",
    "certificate leaf[field.1.2.840.113635.100.6.1.13] exists",
    `certificate leaf[subject.OU] = "${teamId}"`,
  ].join(" and ")

  return {
    extends: "./electron-builder.release.json",
    mac: { identity: `(${teamId})`, forceCodeSigning: true },
    afterAllArtifactBuild: (result) => verifyMacDmgArtifacts(result, requirement),
  }
}
