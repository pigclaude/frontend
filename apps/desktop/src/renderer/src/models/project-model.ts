// 负责界面里的项目显示名和工作区错误说明。

/** 取路径最后一段作为项目名；去掉结尾的斜杠，空路径返回空字符串。 */
export function projectNameFromPath(path: string): string {
  const parts = path
    .trim()
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
  return parts[parts.length - 1] ?? ""
}

/** 主进程给出具体错误时显示它，其他情况使用调用页面的备用文案。 */
export function workspaceErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback
}
