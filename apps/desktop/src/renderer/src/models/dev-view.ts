// 负责解析开发期地址里的 screen、theme、glass 参数，让视觉回归能直接打开指定页面。
import type { Screen } from "../screens/screen"
import { createLoginState, type LoginState, type LoginView } from "./login-model"
import { onboardingSteps, type OnboardingStep } from "./onboarding-model"

/** 开发期可以直接停住的登录阶段。 */
export type DevLoginPhase = Extract<LoginView, "idle" | "waiting" | "confirming" | "error">

const loginPhases: readonly DevLoginPhase[] = ["idle", "waiting", "confirming", "error"]

/**
 * 开发期要直接打开的页面、主题和玻璃效果。
 * phase 让登录页停在指定阶段（同时当作未登录），step 让引导停在指定步骤。
 */
export type DevView = {
  screen: Screen
  theme: "light" | "dark"
  glass: boolean
  phase?: DevLoginPhase
  step?: OnboardingStep
}

const screenNames: Record<Screen, true> = {
  login: true,
  onboarding: true,
  "chat-new": true,
  chat: true,
  profile: true,
  accounts: true,
  "browser-profiles": true,
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
  const phase = loginPhases.find((name) => name === params.get("phase"))
  const step = onboardingSteps.find((name) => name === params.get("step"))
  return {
    screen: screen as Screen,
    theme: params.get("theme") === "dark" ? "dark" : "light",
    glass: params.get("glass") === "1",
    ...(phase && screen === "login" ? { phase } : {}),
    ...(step && screen === "onboarding" ? { step } : {}),
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
