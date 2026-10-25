// 负责个人资料页：身份卡，以及头像、昵称、用户 ID 三行资料。
"use client"

import { useQuery } from "@tanstack/react-query"
import { CircleUserRound, IdCard } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@pigclaude/web-ui/components/button"
import { homeApi } from "@/lib/api"
import { QueryError, QueryLoading } from "@/components/query-state"
import { AccountPageHeader } from "@/components/account/account-page-header"
import { NicknameRow } from "@/components/account/nickname-row"
import { ProfileHero } from "@/components/account/profile-hero"
import { SetGroup, SetRow } from "@/components/account/set-list"
import { UserAvatar } from "@/components/account/user-avatar"

async function copyUserId(id: string) {
  try {
    await navigator.clipboard.writeText(id)
    toast.success("已复制")
  } catch {
    toast.error("复制失败，请手动选择 ID")
  }
}

/** 读取当前用户和会员；会员读取失败不阻塞资料展示。 */
export default function AccountProfilePage() {
  const me = useQuery({ queryKey: ["me"], queryFn: homeApi.user.me })
  const entitlement = useQuery({
    queryKey: ["entitlement"],
    queryFn: homeApi.membership.entitlement,
  })
  const header = (
    <AccountPageHeader title="个人资料" subtitle="别人看到的你，以及账号的基本信息。" />
  )
  if (me.isPending)
    return (
      <>
        {header}
        <QueryLoading label="正在读取账户…" />
      </>
    )
  if (me.isError)
    return (
      <>
        {header}
        <QueryError error={me.error} onRetry={() => void me.refetch()} />
      </>
    )
  const user = me.data
  return (
    <>
      {header}
      <ProfileHero me={user} entitlement={entitlement.data} />
      <SetGroup title="资料">
        <SetRow
          icon={<CircleUserRound />}
          title="头像"
          description="谷歌 / GitHub 注册用对方头像，其余显示首字"
          trailing={
            <UserAvatar id={user.id} nickname={user.nickname} avatar={user.avatar} size={30} />
          }
        />
        <NicknameRow me={user} />
        <SetRow
          icon={<IdCard />}
          title="用户 ID"
          description={<span className="font-mono">{user.id}</span>}
          trailing={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="复制用户 ID"
              onClick={() => void copyUserId(user.id)}
            >
              复制
            </Button>
          }
        />
      </SetGroup>
    </>
  )
}
