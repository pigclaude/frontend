// 按调用方给出的顺序选出第一个仍可用的账号。不读文件，不访问网络。

/** 一个用量窗口。保证带上已用比例和重置时间。 */
export type WindowUsage = {
  usedRatio: number
  resetsAt: string
}

/** 参与选号的账号。保证带上是否启用、冷却截止时间和两个用量窗口。 */
export type SwitchCandidate = {
  id: string
  enabled: boolean
  exhaustedUntil: string | null
  fiveHour: WindowUsage
  sevenDay: WindowUsage
}

type SelectAccountInput = {
  accounts: SwitchCandidate[]
  order: string[]
  now: string
  thresholds: { fiveHour: number; sevenDay: number }
}

/** 按顺序返回第一个可用账号的 id。保证跳过未启用、冷却未结束、或任一窗口用量达到阈值的账号；没有可用账号时返回 null。 */
export function selectAccount(input: SelectAccountInput): string | null {
  const byId = new Map(input.accounts.map((account) => [account.id, account]))
  for (const id of input.order) {
    const account = byId.get(id)
    if (account !== undefined && available(account, input.now, input.thresholds)) return account.id
  }
  return null
}

function available(
  account: SwitchCandidate,
  now: string,
  thresholds: SelectAccountInput["thresholds"],
): boolean {
  const cooled = account.exhaustedUntil === null || account.exhaustedUntil <= now
  const underFiveHour = account.fiveHour.usedRatio < thresholds.fiveHour
  const underSevenDay = account.sevenDay.usedRatio < thresholds.sevenDay
  return account.enabled && cooled && underFiveHour && underSevenDay
}
