// 负责向真实用户菜单提供会话完成退出动作，避免组件自行清缓存造成查询竞争。
"use client"

import { createContext, useContext } from "react"

/** 仅在服务端退出成功后结束本地会话，取消旧查询并导航登录页。 */
export interface HomeSessionActions {
  /** 在服务端确认退出后取消旧查询、清空缓存并进入登录页。 */
  completeLogout: () => Promise<void>
}

/** 由根 Providers 唯一提供退出生命周期，所有菜单复用同一会话边界。 */
export const HomeSessionContext = createContext<HomeSessionActions | null>(null)

/** 返回根会话动作，防止脱离真实 Providers 的菜单绕过会话清理。 */
export function useHomeSessionActions(): HomeSessionActions {
  const actions = useContext(HomeSessionContext)
  if (!actions) throw new Error("用户菜单需要 Home Providers")
  return actions
}
