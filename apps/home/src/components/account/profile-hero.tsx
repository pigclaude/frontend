// 负责个人资料页顶部的身份卡：头像、昵称、邮箱、加入时间和会员状态标签。
import Link from "next/link"
import type { MeResponse } from "@pigclaude/api/home/types"
import type { EntitlementResponse } from "@pigclaude/api/membership/types"
import { UserAvatar } from "@/components/account/user-avatar"
import { SetTag } from "@/components/account/set-list"

const pad = (value: number) => String(value).padStart(2, "0")

function joinedLabel(createdAt: string): string | null {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月加入`
}

function dayLabel(value: string): string {
  const date = new Date(value)
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
}

function MembershipBadge({ entitlement }: { entitlement: EntitlementResponse | undefined }) {
  if (!entitlement) return null
  if (entitlement.status === "active" && entitlement.tier) {
    const until = entitlement.validUntil ? ` · ${dayLabel(entitlement.validUntil)} 到期` : ""
    return <SetTag tone="success">{`${entitlement.tier.name}${until}`}</SetTag>
  }
  return (
    <Link href="/membership" className="profile-hero-link">
      <SetTag tone="muted">{entitlement.status === "none" ? "未开通会员" : "会员已到期"}</SetTag>
    </Link>
  )
}

/** 身份卡以昵称作为区域名；会员信息读取失败时只省略标签，不影响其余内容。 */
export function ProfileHero({
  me,
  entitlement,
}: {
  me: MeResponse
  entitlement: EntitlementResponse | undefined
}) {
  const nickname = me.nickname.trim() || "PigClaude 用户"
  const joined = joinedLabel(me.createdAt)
  return (
    <section className="profile-hero" aria-label={nickname}>
      <UserAvatar id={me.id} nickname={me.nickname} avatar={me.avatar} size={60} />
      <div className="min-w-0">
        <h2 className="profile-hero-name">{nickname}</h2>
        <p className="profile-hero-meta">{joined ? `${me.email} · ${joined}` : me.email}</p>
        <div className="profile-hero-tags">
          <MembershipBadge entitlement={entitlement} />
        </div>
      </div>
    </section>
  )
}
