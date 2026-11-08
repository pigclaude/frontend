// 将已解压且核验通过的固定 PigBrowser 开发包复制到桌面运行资源，保留完整目录及许可证。

const { cp, lstat, mkdir, mkdtemp, rename, rm } = require("node:fs/promises")
const { dirname, join, resolve } = require("node:path")
const { parseArgs } = require("node:util")
const { pigbrowserArtifact, verifyPigbrowserPackage } = require("./pigbrowser-resources.cjs")

async function main() {
  const { values } = parseArgs({
    options: { package: { type: "string" }, target: { type: "string" } },
  })
  if (!values.package || !values.target) {
    throw new Error("请传入 --package 已解压的开发包目录和 --target 平台架构")
  }
  pigbrowserArtifact(values.target)
  const source = resolve(values.package)
  await verifyPigbrowserPackage(source, values.target)
  const destination = join(
    __dirname,
    "runtime-assets",
    "pigclaude-runtime",
    "pigbrowser",
    values.target,
  )
  try {
    await lstat(destination)
    throw new Error("PigBrowser 目标目录已存在，请先核对并移走旧资源")
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  await mkdir(dirname(destination), { recursive: true })
  const temporary = await mkdtemp(join(dirname(destination), ".prepare-"))
  try {
    const prepared = join(temporary, "package")
    await cp(source, prepared, {
      recursive: true,
      verbatimSymlinks: true,
      preserveTimestamps: true,
    })
    const verified = await verifyPigbrowserPackage(prepared, values.target)
    await rename(prepared, destination)
    process.stdout.write(`PigBrowser ${values.target} 已准备：${verified.entries} 项资源\n`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
