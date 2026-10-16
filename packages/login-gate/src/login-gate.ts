// 核对登录桥和 daemon 的出口 IP。不一致或为空时不写入账号授权。

import type { AccountRecord, LocalStore } from "@pigclaude/local-store"

/** 比较桥和 daemon 的出口 IP。两者相等且都非空时允许登录，否则返回请勿登录。 */
export function gateLogin(input: {
  bridgeExitIp: string
  daemonExitIp: string
}): { ok: true } | { ok: false; message: "请勿登录" } {
  if (
    input.bridgeExitIp !== "" &&
    input.daemonExitIp !== "" &&
    input.bridgeExitIp === input.daemonExitIp
  ) {
    return { ok: true }
  }
  return { ok: false, message: "请勿登录" }
}

/** 只有出口核对通过时才保存账号。未通过时不调用 saveAccount，并返回请勿登录。 */
export async function saveAuthorization(input: {
  gate: ReturnType<typeof gateLogin>
  account: AccountRecord
  store: LocalStore
}): Promise<"saved" | "请勿登录"> {
  if (input.gate.ok !== true) return "请勿登录"
  await input.store.saveAccount(input.account)
  return "saved"
}
