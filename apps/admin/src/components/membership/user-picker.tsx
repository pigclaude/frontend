// 负责按邮箱或 ID 搜索用户，保护防抖请求与选中状态的归属。
import { formatTime } from "@/lib/format"
import { useLocation } from "react-router"
import { useEffect, useState } from "react"
import type { UserPick } from "@pigclaude/api/membership/types"
import { adminApi } from "@/lib/api"
import { adminSessionGeneration } from "@/lib/session-generation"
import { useResultGeneration } from "./use-result-generation"
import { useAdminOperationOwner } from "@/hooks/use-admin-operation-owner"
import { Button } from "@/components/ui/button"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Command, CommandInput, CommandList, CommandItem } from "@/components/ui/command"
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
      <div className="flex items-center gap-2 rounded-lg border border-border p-2">
        <span>
          {value.email} <span className="text-xs text-meta">{value.userId}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
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
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          选择用户
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <Command label="搜索用户邮箱或 ID">
          <CommandInput
            aria-label="搜索用户邮箱或 ID"
            placeholder="输入邮箱或 ID"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {!query.trim() ? (
              <p className="p-2 text-sm text-meta">输入至少 1 个字符</p>
            ) : !current ? (
              <p role="status">搜索中…</p>
            ) : current.error ? (
              <p role="alert">{current.error}</p>
            ) : current.items.length === 0 ? (
              <p className="p-2">未找到用户</p>
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
                  <p>{user.email}</p>
                  <p className="text-xs text-meta">{user.userId}</p>
                  <p className="text-xs text-meta">
                    {user.status === "active" && user.tier?.name && user.validUntil
                      ? `${user.tier?.name} · ${formatTime(user.validUntil)} 到期`
                      : "无会员"}
                  </p>
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
