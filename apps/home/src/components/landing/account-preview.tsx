// 负责把原首页透视舞台适配为真实产品具备的账户、会员与设备能力预览。
import { Check, Fingerprint, Laptop, ShieldCheck, UserRound } from "lucide-react"
import { BrandMark } from "@/components/brand-mark"

/** 展示静态能力预览，不伪造用户数据或可点击的桌面操作。 */
export function AccountPreview() {
  return (
    <div className="preview-window" aria-label="账户与设备功能预览">
      <div className="preview-window-top">
        <div className="preview-window-dots" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <BrandMark className="size-6" tone="brand" />
          PigClaude
        </span>
        <span className="text-xs text-[var(--meta)]">账户与设备</span>
      </div>
      <div className="mx-auto max-w-[1060px]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="page-title">每次连接，都由你确认。</h2>
            <p className="mt-2 text-sm text-[var(--meta)]">
              账户、会员和桌面设备，在同一处清晰可见。
            </p>
          </div>
          <ShieldCheck className="size-8 text-[var(--accent-ink)]" />
        </div>
        <div className="card-grid">
          <section className="home-card balance-glow overflow-hidden">
            <span className="inline-flex items-center gap-2 text-xs tracking-wide text-muted-foreground">
              <UserRound className="size-4" />
              你的 PigClaude 账户
            </span>
            <h3 className="relative mt-3 text-[32px] font-semibold tracking-tight">
              一个账户，连接桌面。
            </h3>
            <p className="relative text-sm leading-7 text-[var(--fg-2)]">
              登录网页管理账户，在桌面端继续使用。每一次设备授权，都需要你的明确确认。
            </p>
            <div className="relative mt-3 flex items-center gap-3 border-t border-border pt-5 text-sm text-[var(--fg-2)]">
              <Check className="size-4 text-[var(--success-ink)]" />
              会员权益随账户保持同步
            </div>
          </section>
          <section className="home-card">
            <span className="grid size-11 place-items-center rounded-[var(--radius-md)] bg-[var(--raise-2)] text-[var(--accent-ink)]">
              <Laptop className="size-5" />
            </span>
            <h3>桌面设备授权</h3>
            <dl className="data-list">
              <div>
                <dt>设备身份</dt>
                <dd className="font-mono">•••• ••••</dd>
              </div>
              <div>
                <dt>设备验证</dt>
                <dd className="inline-flex items-center gap-1.5">
                  <Fingerprint className="size-4 text-[var(--accent-ink)]" />
                  安全确认
                </dd>
              </div>
            </dl>
            <p className="text-xs leading-6 text-[var(--meta)]">
              设备信息仅展示必要内容，已有绑定的替换需要再次确认。
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
