// 负责算出主进程构建时要打进包的依赖：安装包只带 files 白名单里的 node_modules，其余依赖留在外部就会在启动时找不到。

const shippedModule = /^node_modules\/((?:@[^/]+\/)?[^/*]+)\/\*\*$/

/**
 * 返回 package.json 运行时依赖里、没有随安装包 files 白名单带上的那些。
 * 主进程构建把它们全部打进包，所以主进程能 require 到的外部依赖都在安装包里。
 */
export function mainBundledDependencies(manifest: unknown, installerConfig: unknown): string[] {
  const dependencies = readRecord(manifest, "dependencies")
  if (typeof dependencies !== "object" || dependencies === null) {
    throw new Error("桌面端 package.json 缺少 dependencies")
  }
  const files = readRecord(installerConfig, "files")
  if (!Array.isArray(files)) throw new Error("安装包配置缺少 files 白名单")
  const shipped = new Set(
    files.flatMap((pattern) => {
      const match = typeof pattern === "string" ? shippedModule.exec(pattern) : null
      return match?.[1] ? [match[1]] : []
    }),
  )
  return Object.keys(dependencies).filter((name) => !shipped.has(name))
}

function readRecord(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined
}
