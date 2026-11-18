// 负责核对固定 PigBrowser 开发包的全部文件、目录与链接，供资源准备和打包共用。

const { createHash } = require("node:crypto")
const { createReadStream } = require("node:fs")
const { lstat, readFile, readdir, readlink } = require("node:fs/promises")
const { isAbsolute, join, relative, resolve } = require("node:path")
const artifacts = require("./pigbrowser-artifacts.json")

/** Linux 安装包只接入这个由官方 Chrome 包安装的系统沙箱助手。 */
const linuxSystemSandboxLink = Object.freeze({
  path: "browser/chrome-sandbox",
  target: "/opt/google/chrome/chrome-sandbox",
})

/** 返回资源合同固定的 native 内核版本。 */
function pigbrowserVersion() {
  return artifacts.version
}

/** 返回已固定的平台产物；不支持的系统和架构明确失败。 */
function pigbrowserArtifact(target) {
  const artifact = artifacts.targets[target]
  if (!Object.hasOwn(artifacts.targets, target)) throw new Error("未配置该平台的 PigBrowser 产物")
  return artifact
}

/** 核对完整开发包；安装态可额外核验 Linux 的固定系统沙箱链接。 */
async function verifyPigbrowserPackage(root, target, { allowLinuxSandboxLink = false } = {}) {
  const artifact = pigbrowserArtifact(target)
  const manifest = await readFile(join(root, "manifest.json"))
  if (createHash("sha256").update(manifest).digest("hex") !== artifact.manifestSha256) {
    throw new Error("PigBrowser 文件清单与固定产物不一致")
  }
  const parsed = JSON.parse(manifest.toString("utf8"))
  const entries = parsed.schema_version === 1 ? parsed.files : parsed
  const expected = new Set([
    "manifest.json",
    ...Object.keys(entries).filter((path) => path !== "."),
  ])
  for (const [path, entry] of Object.entries(entries)) {
    const file = resolve(root, path)
    const rel = relative(resolve(root), file)
    if (isAbsolute(path) || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("PigBrowser 文件清单包含越界路径")
    }
    const info = await lstat(file)
    if (entry.symlink !== undefined) {
      if (!info.isSymbolicLink() || (await readlink(file)) !== entry.symlink) {
        throw new Error(`PigBrowser 链接不一致：${path}`)
      }
    } else if (entry.directory === true) {
      if (!info.isDirectory()) throw new Error(`PigBrowser 目录缺损：${path}`)
    } else if (
      !info.isFile() ||
      info.size !== entry.bytes ||
      (await hashFile(file)) !== entry.sha256
    ) {
      throw new Error(`PigBrowser 文件缺损：${path}`)
    }
    if (
      process.platform !== "win32" &&
      !target.startsWith("win32-") &&
      entry.mode !== undefined &&
      (info.mode & 0o777) !== entry.mode
    ) {
      throw new Error(`PigBrowser 文件权限不一致：${path}`)
    }
  }
  const actual = await listFiles(root)
  if (
    allowLinuxSandboxLink &&
    target === "linux-x64" &&
    actual.includes(linuxSystemSandboxLink.path)
  ) {
    const link = join(root, linuxSystemSandboxLink.path)
    if (
      !(await lstat(link)).isSymbolicLink() ||
      (await readlink(link)) !== linuxSystemSandboxLink.target
    ) {
      throw new Error("PigBrowser 系统沙箱助手链接不一致")
    }
    expected.add(linuxSystemSandboxLink.path)
  }
  if (actual.length !== expected.size || actual.some((path) => !expected.has(path))) {
    throw new Error("PigBrowser 目录含有未列入固定清单的资源")
  }
  return { executable: join(root, artifact.executable), entries: actual.length }
}

/** 按流计算文件的 SHA-256，大包也不整个读进内存。 */
async function hashFile(path) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

async function listFiles(root, prefix = "") {
  const paths = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    paths.push(path)
    if (entry.isDirectory()) paths.push(...(await listFiles(root, path)))
  }
  return paths
}

module.exports = {
  hashFile,
  linuxSystemSandboxLink,
  pigbrowserArtifact,
  pigbrowserVersion,
  verifyPigbrowserPackage,
}
