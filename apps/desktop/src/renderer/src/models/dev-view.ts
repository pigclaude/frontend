// 负责解析开发期地址里的 screen、theme、glass 参数，让视觉回归能直接打开指定页面。
import type { Screen } from "../screens/screen"

/** 开发期要直接打开的页面、主题和玻璃效果。 */
export type DevView = { screen: Screen; theme: "light" | "dark"; glass: boolean }

const screenNames: Record<Screen, true> = {
  login: true,
  onboarding: true,
  "chat-new": true,
  chat: true,
  profile: true,
  accounts: true,
  proxies: true,
  switching: true,
  usage: true,
  environment: true,
  general: true,
  appearance: true,
  session: true,
  tray: true,
  menubar: true,
  network: true,
  data: true,
  about: true,
  authorize: true,
}

/** 全部页面名，顺序与 Screen 联合类型一致。 */
export const allScreens = Object.keys(screenNames) as Screen[]

/** 解析地址查询串。非开发模式或页面名不合法时返回 null；缺省主题为 light，缺省玻璃为关。 */
export function parseDevView(search: string, dev: boolean): DevView | null {
  if (!dev) return null
  const params = new URLSearchParams(search)
  const screen = params.get("screen")
  if (!screen || !Object.hasOwn(screenNames, screen)) return null
  return {
    screen: screen as Screen,
    theme: params.get("theme") === "dark" ? "dark" : "light",
    glass: params.get("glass") === "1",
  }
}
