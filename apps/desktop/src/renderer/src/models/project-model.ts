// 负责侧栏项目的命名规则：项目名取自文件夹名。

/** 取路径最后一段作为项目名；去掉结尾的斜杠，空路径返回空字符串。 */
export function projectNameFromPath(path: string): string {
  const parts = path
    .trim()
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
  return parts[parts.length - 1] ?? ""
}
