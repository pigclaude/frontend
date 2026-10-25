// 负责以原后台用户详情抽屉展示当前列表返回的真实摘要。
import { Link } from "react-router"
import { AccountActions } from "./account-actions"
import { useAdminMe } from "@/hooks/use-admin-me"
import { canAdminPermission } from "@/lib/admin-permissions"
import type { AccountModerationView } from "@pigclaude/contracts/account-status"
import type { AdminUserItem } from "@pigclaude/api/admin/types"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { DetailList, DetailRow } from "@/components/shell/detail-list"
import { formatTime } from "@/lib/format"

/** 用户详情保留原头像摘要和键值信息，只展示现有 API 已返回的数据。 */
export function UserDrawer({
  user,
  open,
  onOpenChange,
  onUpdate,
  onConflict,
}: {
  user: AdminUserItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (view: AccountModerationView) => void
  onConflict: () => void
}) {
  const { data: me } = useAdminMe()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        {user && (
          <>
            <SheetHeader>
              <SheetTitle>用户详情</SheetTitle>
              <SheetDescription className="sr-only">用户账号摘要</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 p-5">
              <div className="flex items-center gap-3.5">
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt=""
                    className="size-12 shrink-0 rounded-full border border-border object-cover"
                  />
                ) : (
                  <span className="grid size-12 shrink-0 place-items-center rounded-full border border-border bg-raise-3 text-lg font-semibold text-foreground">
                    {user.nickname.slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-foreground">
                      {user.nickname}
                    </span>
                    {user.status === "active" ? (
                      <Badge variant="success" dot>
                        正常
                      </Badge>
                    ) : (
                      <Badge variant="danger" dot>
                        已封禁
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-meta">UID {user.id}</p>
                </div>
              </div>

              <DetailList>
                <DetailRow label="邮箱">{user.email || "—"}</DetailRow>
                <DetailRow label="GitHub">
                  {user.githubLogin ? `@${user.githubLogin}` : "未绑定"}
                </DetailRow>
                <DetailRow label="注册时间">{formatTime(user.createdAt)}</DetailRow>
                <DetailRow label="最近登录">
                  {user.lastLoginAt ? formatTime(user.lastLoginAt) : "从未登录"}
                </DetailRow>
                <DetailRow label="账号版本">{user.authVersion}</DetailRow>
              </DetailList>
              {me?.status === "active" && canAdminPermission(me.permissions, "device:read") && (
                <Link
                  className="text-sm underline"
                  to={`/devices?userId=${encodeURIComponent(user.id)}`}
                >
                  查看该账号设备
                </Link>
              )}
              <AccountActions
                key={user.id}
                user={user}
                onUpdate={onUpdate}
                onConflict={onConflict}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
