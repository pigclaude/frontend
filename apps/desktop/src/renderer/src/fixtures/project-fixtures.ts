// 负责提供侧栏项目树使用的脱敏示例项目和会话。
import type { Project } from "../models/project-model"

/** 侧栏初始项目，会话只含标题和时间。 */
export const projectFixtures: Project[] = [
  {
    id: "~/workspace/pigclaude/frontend",
    name: "frontend",
    sessions: [
      { id: "s-daemon", title: "流开始后不再换号", time: "刚刚", live: true },
      { id: "s-tz", title: "补 session-env 时区测试", time: "1小时", live: false },
      { id: "s-gate", title: "login-gate 出口核对", time: "昨天", live: false },
    ],
  },
  {
    id: "~/workspace/pigclaude/permission-api",
    name: "permission-api",
    sessions: [{ id: "s-axum", title: "axum 0.8 State 改写", time: "昨天", live: false }],
  },
  { id: "~/workspace/cchelper", name: "cchelper", sessions: [] },
]
