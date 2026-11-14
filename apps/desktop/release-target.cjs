// 负责决定这次发版的 tag 和版本：推 tag 时 tag 必须与桌面端版本一致，手动触发只做测试发布。

const { readFileSync } = require("node:fs")
const { join } = require("node:path")

const VERSION = /^\d+\.\d+\.\d+$/
const TEST_TAG = /^desktop-v\d+\.\d+\.\d+-test\.\d+$/

/**
 * 决定这次发版的 tag 和版本。推 tag 时 tag 必须是 `v<桌面端版本>`；
 * 手动触发的测试发布只接受 `desktop-v<x.y.z>-test.<n>` 这样的 tag，版本仍取桌面端版本。
 */
function releaseTarget({ event, pushedTag, testTag, version }) {
  if (!VERSION.test(version)) throw new Error(`桌面端版本 ${version} 不是 x.y.z`)
  if (event === "workflow_dispatch") {
    if (!TEST_TAG.test(testTag ?? "")) {
      throw new Error(`测试发布的 tag 必须形如 desktop-v0.0.0-test.1，收到 ${testTag}`)
    }
    return { tag: testTag, version, test: true }
  }
  if (pushedTag !== `v${version}`) {
    throw new Error(`tag ${pushedTag} 与桌面端版本 ${version} 不一致，应为 v${version}`)
  }
  return { tag: pushedTag, version, test: false }
}

module.exports = { releaseTarget }

if (require.main === module) {
  try {
    const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"))
    const target = releaseTarget({
      event: process.env.GITHUB_EVENT_NAME,
      pushedTag: process.env.GITHUB_REF_NAME,
      testTag: process.env.TEST_TAG,
      version,
    })
    process.stdout.write(`tag=${target.tag}\nversion=${target.version}\ntest=${target.test}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
