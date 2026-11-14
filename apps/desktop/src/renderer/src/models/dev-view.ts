// 负责解析开发期地址里的 screen、theme、glass 参数，让视觉回归能直接打开指定页面；
// screen 用页面名表示，和导航位置一一对应。workbench=1 让会话页接上演示工作台。
import { createLoginState, type LoginState, type LoginView } from "./login-model"
import type { NavLocation } from "./navigation"
import { onboardingSteps, type OnboardingStep } from "./onboarding-model"

/** 开发期可以直接停住的登录阶段。 */
export type DevLoginPhase = Extract<LoginView, "idle" | "waiting" | "confirming" | "error">

const loginPhases: readonly DevLoginPhase[] = ["idle", "waiting", "confirming", "error"]

/** 设置页的页面名，也是设置页的 id。 */
const settingsPageNames = [
  "profile",
  "accounts",
  "browser-profiles",
  "proxies",
  "switching",
  "usage",
  "environment",
  "general",
  "appearance",
  "session",
  "menubar",
  "network",
  "data",
  "about",
] as const

/** 开发期地址里 screen 参数能用的页面名。 */
export type DevScreen =
  | "login"
  | "onboarding"
  | "authorize"
  | "chat-new"
  | "chat"
  | "tray"
  | (typeof settingsPageNames)[number]

/** 全部页面名；视觉回归按这个顺序截图。 */
export const allScreens: readonly DevScreen[] = [
  "login",
  "onboarding",
  "chat-new",
  "chat",
  ...settingsPageNames,
  "tray",
  "authorize",
]

/**
 * 开发期要直接打开的位置、主题和玻璃效果。
 * phase 让登录页停在指定阶段（同时当作未登录），step 让引导停在指定步骤，
 * workbench 让会话页接上只读的演示工作台。
 */
export type DevView = {
  location: NavLocation
  theme: "light" | "dark"
  glass: boolean
  phase?: DevLoginPhase
  step?: OnboardingStep
  workbench?: true
}

/** 页面名对应的导航位置。 */
export function locationOfScreen(name: DevScreen): NavLocation {
  if (name === "login" || name === "onboarding" || name === "authorize") {
    return { kind: "flow", flow: name }
  }
  if (name === "chat-new") return { kind: "draft" }
  if (name === "chat") return { kind: "session" }
  if (name === "tray") return { kind: "tray" }
  return { kind: "settings", page: name }
}

/** 导航位置对应的页面名；设置页就是它的 id。 */
export function screenOfLocation(location: NavLocation): string {
  if (location.kind === "draft") return "chat-new"
  if (location.kind === "session") return "chat"
  if (location.kind === "settings") return location.page
  if (location.kind === "flow") return location.flow
  return "tray"
}

function isDevScreen(name: string): name is DevScreen {
  return (allScreens as readonly string[]).includes(name)
}

/** 解析地址查询串。非开发模式或页面名不合法时返回 null；缺省主题为 light，缺省玻璃为关。 */
export function parseDevView(search: string, dev: boolean): DevView | null {
  if (!dev) return null
  const params = new URLSearchParams(search)
  const screen = params.get("screen")
  if (!screen || !isDevScreen(screen)) return null
  const phase = loginPhases.find((name) => name === params.get("phase"))
  const step = onboardingSteps.find((name) => name === params.get("step"))
  return {
    location: locationOfScreen(screen),
    theme: params.get("theme") === "dark" ? "dark" : "light",
    glass: params.get("glass") === "1",
    ...(phase && screen === "login" ? { phase } : {}),
    ...(step && screen === "onboarding" ? { step } : {}),
    ...(params.get("workbench") === "1" && (screen === "chat" || screen === "chat-new")
      ? { workbench: true as const }
      : {}),
  }
}

/** 为只读开发预览生成明确的登录阶段，不参与真实授权。 */
export function devLoginState(phase: DevLoginPhase | undefined): LoginState {
  const idle = createLoginState()
  if (phase === "waiting") {
    return {
      ...idle,
      view: "waiting",
      intent: "login",
      sessionId: "dev-preview",
      authorizationUrl: "https://pigclaude.example/oauth2/authorize",
      expiresAt: 4_102_444_800_000,
    }
  }
  if (phase === "confirming") {
    return { ...idle, view: "confirming", intent: "login", displayName: "小猪" }
  }
  if (phase === "error") return { ...idle, view: "error", error: "授权已过期，请重新授权。" }
  return idle
}
