// 负责侧栏项目列表的新增规则：项目名取自文件夹，同一文件夹不重复添加。

/** 侧栏里的一条会话链接。 */
export type SessionLink = { id: string; title: string; time: string; live: boolean }

/** 侧栏里的一个项目。id 是文件夹路径，name 是文件夹名。 */
export type Project = { id: string; name: string; sessions: SessionLink[] }

/** 取路径最后一段作为项目名；去掉结尾的斜杠，空路径返回空字符串。 */
export function projectNameFromPath(path: string): string {
  const parts = path
    .trim()
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
  return parts[parts.length - 1] ?? ""
}

/** 新增项目并放在最前；路径为空或已存在时原样返回。 */
export function addProject(projects: Project[], path: string): Project[] {
  const id = path.trim().replace(/[\\/]+$/, "")
  const name = projectNameFromPath(id)
  if (!name || projects.some((project) => project.id === id)) return projects
  return [{ id, name, sessions: [] }, ...projects]
}
