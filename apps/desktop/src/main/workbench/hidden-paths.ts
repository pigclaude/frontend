// 负责工作台的路径隐藏规则：哪些目录不能经工作台读写、比较和恢复，哪些目录不在文件树里列出。
// 文件树、文件读写、Diff 和检查点都从这里取规则。

const PRIVATE_NAMES = [".git", ".claude"]
const UNLISTED_NAMES = ["node_modules", ".superpowers"]

/** 目录名是否属于版本库内部或 Claude Code 配置；不区分大小写。 */
export function privateWorkbenchName(name: string): boolean {
  return PRIVATE_NAMES.includes(name.toLowerCase())
}

/** 项目内相对路径是否经过版本库内部或 Claude Code 配置目录。 */
export function protectedWorkbenchPath(path: string): boolean {
  return path.split("/").some(privateWorkbenchName)
}

/** 文件树是否列出这个目录项；不能访问的目录和依赖、工具缓存目录都不列出。 */
export function listedWorkbenchName(name: string): boolean {
  return !privateWorkbenchName(name) && !UNLISTED_NAMES.includes(name)
}

/** Git 路径规则只匹配项目文件，排除各层 Claude Code 的本地配置；受保护的路径直接拒绝。 */
export function workbenchPathspec(path = "."): string[] {
  if (protectedWorkbenchPath(path)) throw new Error("WORKBENCH_PATH_INVALID")
  return [path === "." ? "." : ":(literal)" + path, ":(exclude,icase,glob)**/.claude/**"]
}
