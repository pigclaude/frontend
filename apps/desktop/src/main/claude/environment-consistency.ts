// 将浏览器实际观测与主进程本轮 native 启动证据关联，不能把两端各自通过当成环境相同。

import type {
  BrowserEnvironmentFacts,
  EnvironmentCheckContext,
  EnvironmentCheckItem,
} from "./environment-check-model"
import { environmentCheckItem } from "./environment-policy"
import { sameProfileEnvironment } from "../session/profile-environment"

/** 相同实例版本、native 启动证据与两个浏览器页面都完整时才判断环境一致。 */
export function environmentConsistencyCheck(
  context: EnvironmentCheckContext,
  facts: BrowserEnvironmentFacts[],
): EnvironmentCheckItem {
  const native = context.request.nativeEvidence
  const environment = native?.environment
  const profile = context.request.browserProfile
  const complete =
    facts.length === 2 &&
    environment &&
    profile &&
    Number.isSafeInteger(profile.revision) &&
    profile.revision > 0 &&
    native.checks.find((check) => check.id === "cli-launch")?.state === "passed"
  const matched =
    complete &&
    facts.every((value) =>
      sameProfileEnvironment(environment, { locale: value.language, timezone: value.timezone }),
    )
  return environmentCheckItem(
    "environment-consistency",
    context.network.mode,
    !complete ? "unknown" : matched ? "passed" : "failed",
    {
      expected: "浏览器、CLI 的语言和时区来自本轮同一浏览器配置版本",
      actual: environment
        ? `实例版本 ${profile?.revision ?? "未确认"}；CLI ${environment.locale} / ${environment.timezone}；浏览器${matched ? "一致" : "未通过一致性核对"}`
        : "缺少本轮 CLI 环境与实例版本证据",
      evidence:
        "主进程 native spawn 的实际 TZ/LANG/LC_ALL 已核对；浏览器两个页面实际值交叉比较；CLI 内部 Intl 另行标明未覆盖",
      remedy: matched
        ? "无需处理；账号共享配置但不共享 Cookie 和登录数据"
        : "核对所选浏览器配置与实际 CLI 启动环境，重新检测前不继续授权",
    },
  )
}
