// 负责描述 renderer 的项目折叠和新会话导航结果。
import type { Screen } from "../screens/screen"

/** 项目折叠后的导航状态。 */
export type ProjectNavigationState = {
  expandedProjects: Record<string, boolean>
}

/** 新会话导航状态。 */
export type NewSessionNavigationState = {
  screen: Extract<Screen, "chat-new">
  projectId?: string
}

/** renderer 导航模型可以产生的状态。 */
export type NavigationState = ProjectNavigationState | NewSessionNavigationState

/** 返回只改变指定项目展开状态的导航结果。 */
export function toggleProject(projectId: string, expanded: boolean): ProjectNavigationState {
  return { expandedProjects: { [projectId]: expanded } }
}

/** 返回带有可选工作区上下文的新会话导航结果。 */
export function openNewSession(projectId?: string): NewSessionNavigationState {
  return { screen: "chat-new", ...(projectId ? { projectId } : {}) }
}
