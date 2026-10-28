// 管理短期、一次性的撤销确认，身份材料留在 main，确认只约束原本选择的账号与设备关系。
import { randomUUID } from "node:crypto"
import type { DeviceWithdrawalConfirmation } from "@pigclaude/contracts/desktop-membership"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { OAuthSnapshot } from "../authorization/oauth-token-manager"
import { PigclaudeApiError } from "../api/pigclaude-api-client"
import type { MembershipGate } from "./membership-gate"
type Confirmation = { id: string; contextId: string; target: OAuthSnapshot; expiresAt: number }
/** 一次只保留一份有效确认，提交前消费并在主进程拒绝重复操作。 */
export class DeviceWithdrawalService {
  #confirmation: Confirmation | null = null
  #preparations = 0
  #submitting = false
  /** 共用门禁的可信身份与时钟，不接受 renderer 的用户或设备目标。 */
  constructor(
    private readonly gate: MembershipGate,
    private readonly now: () => number,
  ) {}
  /** 准备只读确认，旧界面及并发准备的迟到结果不会替换当前确认。 */
  async prepare(contextId: string): Promise<DeviceWithdrawalConfirmation> {
    if (this.#submitting) throw new PigclaudeApiError("WITHDRAWAL_IN_PROGRESS", 0)
    const request = ++this.#preparations
    this.#confirmation = null
    const target = await this.gate.prepareRevocation(contextId)
    if (
      request !== this.#preparations ||
      this.#submitting ||
      !this.gate.matchesAccountContext(contextId, target.owner)
    )
      throw new PigclaudeApiError("WITHDRAWAL_TARGET_CHANGED", 0)
    const id = randomUUID()
    const expiresAt = this.now() + 120_000
    const account = this.gate.view().account
    if (!account || account.userId !== target.record.userId)
      throw new PigclaudeApiError("WITHDRAWAL_TARGET_CHANGED", 0)
    this.#confirmation = { id, contextId, target, expiresAt }
    return {
      confirmationId: id,
      account: { nickname: account.nickname, email: account.email },
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }
  /** 确认只执行最初绑定的关系，同族轮换可用，真实换会话或关系变化必须重新确认。 */
  async confirm(id: string): Promise<MembershipView> {
    const confirmation = this.#confirmation
    if (this.#submitting || !confirmation || confirmation.id !== id)
      throw new PigclaudeApiError("WITHDRAWAL_TARGET_CHANGED", 0)
    this.#confirmation = null
    if (
      confirmation.expiresAt <= this.now() ||
      !this.gate.matchesAccountContext(confirmation.contextId, confirmation.target.owner)
    )
      throw new PigclaudeApiError("WITHDRAWAL_TARGET_CHANGED", 0)
    this.#submitting = true
    try {
      const view = await this.gate.revoke(confirmation.target)
      if (view.state !== "signed_out") throw new PigclaudeApiError("WITHDRAWAL_NOT_COMPLETED", 0)
      return view
    } finally {
      this.#submitting = false
    }
  }
}
