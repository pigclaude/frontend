// 负责账号与代理页面的纯状态更新，不写入本机文件。
import { createPoolFixtures, type PoolAccount, type PoolProxy } from "../fixtures/pool-fixtures"

/** 账号与代理弹层状态。 */
export type PoolDialog =
  { type: "delete-account"; accountId: string } | { type: "proxy"; accountId: string } | null

/** 账号与代理页面状态。 */
export type PoolState = {
  accounts: PoolAccount[]
  proxies: PoolProxy[]
  dialog: PoolDialog
  testingProxyId: string | null
}

/** 账号与代理状态变化事件。 */
export type PoolEvent =
  | { type: "open-delete"; accountId: string }
  | { type: "cancel-dialog" }
  | { type: "confirm-delete" }
  | { type: "bind-proxy"; accountId: string; proxyId: string }
  | { type: "start-test"; proxyId: string }
  | { type: "finish-test"; proxyId: string }

/** 创建账号与代理页面的初始状态。 */
export function createPoolState(): PoolState {
  const fixtures = createPoolFixtures()
  return { ...fixtures, dialog: null, testingProxyId: null }
}

/** 按事件更新账号与代理状态，取消弹层不改变数据引用。 */
export function reducePoolState(state: PoolState, event: PoolEvent): PoolState {
  if (event.type === "open-delete")
    return { ...state, dialog: { type: "delete-account", accountId: event.accountId } }
  if (event.type === "cancel-dialog") return { ...state, dialog: null }
  if (event.type === "confirm-delete" && state.dialog?.type === "delete-account") {
    const accountId = state.dialog.accountId
    return {
      ...state,
      accounts: state.accounts.filter((account) => account.id !== accountId),
      dialog: null,
    }
  }
  if (event.type === "bind-proxy") {
    return {
      ...state,
      accounts: state.accounts.map((account) =>
        account.id === event.accountId ? { ...account, proxyId: event.proxyId } : account,
      ),
      proxies: state.proxies.map((proxy) =>
        proxy.accountId === event.accountId || proxy.id === event.proxyId
          ? { ...proxy, accountId: proxy.id === event.proxyId ? event.accountId : null }
          : proxy,
      ),
    }
  }
  if (event.type === "start-test") return { ...state, testingProxyId: event.proxyId }
  if (event.type === "finish-test" && state.testingProxyId === event.proxyId)
    return { ...state, testingProxyId: null }
  return state
}
