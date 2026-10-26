// 负责从本机账号库选出 daemon 可用的账号。每次选号都读取最新账号和代理，
// 刷新临期凭据，并过滤禁用、需重新授权、冷却、已拒绝和代理缺失的账号。

import type { AccountRecord, IpProxy, LocalStore } from "@pigclaude/local-store"
import { selectAccount, type SwitchCandidate } from "@pigclaude/switcher"
import type { CredentialRefresher } from "../claude/credential-refresher"

/** 一次选号的输入。保证 rejectedIds 中的账号不参与选择，preferredId 只表示偏好。 */
export type ChooseAccountInput = {
  rejectedIds: readonly string[]
  preferredId?: string
}

/** daemon 需要的账号材料。保证只包含账号 id、Bearer 凭据和代理地址。 */
export type ChosenAccount = {
  id: string
  authorization: string
  proxyUrl: string
}

/** 选号依赖。保证账号和代理每次从 store 读取，凭据刷新可注入。 */
export type AccountChooserOptions = {
  store: Pick<LocalStore, "listAccounts" | "listProxies">
  refresher: Pick<CredentialRefresher, "refreshIfNeeded">
  now?: () => number
}

type EligibleAccount = {
  account: AccountRecord
  proxy: IpProxy
  authorization: string
}

// 第一版没有完整用量窗口，所有已授权且未冷却的账号都可通过这两个阈值。
const thresholds = { fiveHour: 1, sevenDay: 1 }

/** 按用户顺序选择第一个可用账号。保证过滤禁用、需重新授权、无凭据、冷却、已拒绝和代理缺失的账号；凭据刷新失败时跳过该账号；没有可用账号时返回 null。 */
export class AccountChooser {
  readonly #store: AccountChooserOptions["store"]
  readonly #refresher: AccountChooserOptions["refresher"]
  readonly #now: () => number

  /** 创建绑定到本机账号库和凭据刷新器的选号器。 */
  constructor(options: AccountChooserOptions) {
    this.#store = options.store
    this.#refresher = options.refresher
    this.#now = options.now ?? Date.now
  }

  /** 读取最新账号和代理，刷新临期凭据，并返回首选或按用户顺序选出的账号。 */
  async choose(input: ChooseAccountInput): Promise<ChosenAccount | null> {
    const nowMs = this.#now()
    const nowIso = new Date(nowMs).toISOString()
    const rejected = new Set(input.rejectedIds)
    const proxies = new Map((await this.#store.listProxies()).map((proxy) => [proxy.id, proxy]))
    const eligible = (await this.#store.listAccounts()).filter((account) =>
      isEligible(account, proxies, rejected, nowMs),
    )
    const refreshed = await this.#refresh(eligible, proxies)
    const byId = new Map(refreshed.map((item) => [item.account.id, item]))

    if (input.preferredId !== undefined) {
      const preferred = byId.get(input.preferredId)
      if (preferred !== undefined) return toChosen(preferred)
    }
    const selected = selectAccount({
      accounts: refreshed.map(({ account }) => toCandidate(account, nowIso)),
      order: refreshed.map(({ account }) => account.id),
      now: nowIso,
      thresholds,
    })
    const picked = selected === null ? undefined : byId.get(selected)
    return picked === undefined ? null : toChosen(picked)
  }

  /** 不刷新凭据、不消耗额度地判断当前是否至少有一个可被选中的账号。 */
  async hasAvailableAccount(): Promise<boolean> {
    const nowMs = this.#now()
    const proxies = new Map((await this.#store.listProxies()).map((proxy) => [proxy.id, proxy]))
    return (await this.#store.listAccounts()).some((account) =>
      isEligible(account, proxies, new Set<string>(), nowMs),
    )
  }

  // 只刷新通过静态过滤的账号；刷新失败或刷新后凭据为空时跳过，不影响其他账号。
  async #refresh(
    eligible: AccountRecord[],
    proxies: Map<string, IpProxy>,
  ): Promise<EligibleAccount[]> {
    const refreshed: EligibleAccount[] = []
    for (const account of eligible) {
      try {
        const updated = await this.#refresher.refreshIfNeeded(account)
        const proxy = proxies.get(updated.proxyId)
        const authorization = updated.credential?.accessToken
        if (authorization === undefined || proxy === undefined) continue
        refreshed.push({ account: updated, proxy, authorization })
      } catch {
        continue
      }
    }
    return refreshed
  }
}

/** 静态判断账号是否可用：启用、不需要重新授权、有凭据且不在额度冷却中。选号器和启动预检共用。 */
export function isAccountAvailable(account: AccountRecord, nowMs: number): boolean {
  if (!account.enabled || account.needsReauth || account.credential === null) return false
  return !coolingDown(account.exhaustedUntil, nowMs)
}

function isEligible(
  account: AccountRecord,
  proxies: Map<string, IpProxy>,
  rejected: Set<string>,
  nowMs: number,
): boolean {
  if (!isAccountAvailable(account, nowMs)) return false
  if (rejected.has(account.id)) return false
  const proxy = proxies.get(account.proxyId)
  return proxy !== undefined && proxy.url !== ""
}

function coolingDown(exhaustedUntil: string | null, nowMs: number): boolean {
  if (exhaustedUntil === null) return false
  const until = Date.parse(exhaustedUntil)
  return Number.isFinite(until) && until > nowMs
}

function toCandidate(account: AccountRecord, nowIso: string): SwitchCandidate {
  const window = { usedRatio: 0, resetsAt: nowIso }
  return {
    id: account.id,
    enabled: account.enabled,
    exhaustedUntil: account.exhaustedUntil,
    fiveHour: window,
    sevenDay: window,
  }
}

function toChosen({ account, proxy, authorization }: EligibleAccount): ChosenAccount {
  return {
    id: account.id,
    authorization,
    proxyUrl: proxy.url,
  }
}
