// 负责按邮箱或 ID 内联搜索用户，保护防抖请求与选中状态的归属。
import { Search } from "lucide-react"
import { TierBadge } from "@pigclaude/web-ui/components/tier-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatTime } from "@/lib/format"
import { useLocation } from "react-router"
import { useEffect, useState } from "react"
import type { UserPick } from "@pigclaude/api/membership/types"
import { adminApi } from "@/lib/api"
import { adminSessionGeneration } from "@/lib/session-generation"
import { useResultGeneration } from "./use-result-generation"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
import { Button } from "@/components/ui/button"
import { Command, CommandInput, CommandList, CommandItem } from "@/components/ui/command"
import { fieldClass } from "@/components/ui/input"
import { cn } from "@pigclaude/web-ui/lib/utils"

/** 选中完整的服务器用户摘要，清除时恢复搜索，旧请求不能改写当前结果。 */
export function UserPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: UserPick | null
  onChange: (value: UserPick | null) => void
  disabled?: boolean
}) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const key = JSON.stringify([location.key, open, disabled, value?.userId, query])
  const { generation, isCurrent } = useResultGeneration(key)
  const [result, setResult] = useState<{
    generation: typeof generation
    items: UserPick[]
    error?: string
  } | null>(null)
  const operation = useAdminOperationOwner(JSON.stringify([key, generation.version]))
  useEffect(() => {
    if (!open || disabled || value || !query.trim()) return
    const session = generation.session
    const timer = setTimeout(() => {
      if (session !== adminSessionGeneration.current()) return
      const owner = operation.begin()
      if (!owner) return
      void adminApi.membership.users
        .search(query.trim())
        .then(({ items }) => {
          if (owner.isCurrent()) setResult({ generation, items })
        })
        .catch(() => {
          if (owner.isCurrent())
            setResult({ generation, items: [], error: "搜索失败，请修改输入后重试" })
        })
        .finally(owner.finish)
    }, 250)
    return () => clearTimeout(timer)
  }, [open, disabled, value, query, generation, operation.begin])
  if (value)
    return (
      <div className="flex w-full items-center gap-3 rounded-lg border border-border bg-[var(--input-bg)] p-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-raise-3 text-sm font-semibold text-foreground uppercase"
        >
          {value.email.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{value.email}</p>
          <p className="truncate text-xs text-meta">{value.userId}</p>
          {value.status === "active" && value.tier && value.validUntil ? (
            <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-meta">
              <TierBadge {...value.tier} />
              <span>{formatTime(value.validUntil)} 到期</span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-meta">无会员</p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setOpen(false)
            setQuery("")
            onChange(null)
          }}
        >
          清除用户
        </Button>
      </div>
    )
  const current =
    result?.generation === generation && generation.session === adminSessionGeneration.current()
      ? result
      : null
  return (
    <Command
      shouldFilter={false}
      label="搜索用户邮箱或 ID"
      className="relative w-full overflow-visible"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-meta" />
        <CommandInput
          role="combobox"
          aria-label="搜索用户邮箱或 ID"
          aria-expanded={open}
          placeholder="搜索邮箱或 ID"
          value={query}
          disabled={disabled}
          className={cn(fieldClass, "h-10 rounded-lg pr-3 pl-9 text-sm")}
          onValueChange={(next) => {
            setQuery(next)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false)
          }}
        />
      </div>
      {open && (
        <div
          className="absolute inset-x-0 top-full z-30 mt-1.5 rounded-lg border border-border bg-popover p-1 shadow-[var(--menu-shadow)]"
          // 点选候选时保持输入框焦点，失焦关闭只发生在点击浮层外部。
          onMouseDown={(event) => event.preventDefault()}
        >
          <CommandList className="max-h-60 overflow-y-auto">
            {!query.trim() ? (
              <p className="p-2 text-sm text-meta">输入邮箱或用户 ID 开始搜索</p>
            ) : !current ? (
              <div role="status" aria-label="正在搜索用户" className="p-2">
                <Skeleton className="h-10 w-full" />
              </div>
            ) : current.error ? (
              <p role="alert" className="p-2 text-sm text-danger-ink">
                {current.error}
              </p>
            ) : current.items.length === 0 ? (
              <p className="p-2 text-sm text-meta">未找到用户</p>
            ) : (
              current.items.map((user) => (
                <CommandItem
                  key={user.userId}
                  value={user.userId}
                  onSelect={() => {
                    if (!isCurrent()) return
                    onChange(user)
                    setOpen(false)
                    setQuery("")
                  }}
                >
                  <p className="truncate text-sm">{user.email}</p>
                  <p className="truncate text-xs text-meta">{user.userId}</p>
                  <p className="flex flex-wrap items-center gap-1 text-xs text-meta">
                    {user.status === "active" && user.tier && user.validUntil ? (
                      <>
                        <TierBadge {...user.tier} />
                        <span> · {formatTime(user.validUntil)} 到期</span>
                      </>
                    ) : (
                      "无会员"
                    )}
                  </p>
                </CommandItem>
              ))
            )}
          </CommandList>
        </div>
      )}
    </Command>
  )
}
