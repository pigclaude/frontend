// 负责网站 /login 自动发起登录的防循环记录：短时间内重复自动发起时改为等待用户点击。
const keyPrefix = "pigclaude:oidc-auto-start:"
/** 两次自动发起之间的最短间隔；更短说明登录后又被立刻送回了 /login。 */
export const autoStartGuardWindow = 10_000

// 存储不可用或记录损坏时按允许处理，与没有防护时一致。
/** 记录本次自动发起并返回是否允许；距上次自动发起不足 10 秒时返回 false 且不覆盖记录。 */
export function claimAutoStart(site: "home" | "admin", now: number = Date.now()): boolean {
  const key = keyPrefix + site
  try {
    const previous = Number(sessionStorage.getItem(key))
    if (previous > 0 && previous <= now && now - previous < autoStartGuardWindow) return false
    sessionStorage.setItem(key, String(now))
  } catch {
    // 存储异常只关闭防护，不阻止登录。
  }
  return true
}
