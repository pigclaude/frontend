// 负责昵称行的就地编辑：回车保存、Esc 取消，保存中禁用，失败在行内提示，成功后同步顶栏。
"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { PenLine } from "lucide-react"
import { ApiError } from "@pigclaude/api/client"
import type { MeResponse } from "@pigclaude/api/home/types"
import { Button } from "@pigclaude/web-ui/components/button"
import { Input } from "@pigclaude/web-ui/components/input"
import { homeApi } from "@/lib/api"
import { useOwnedAction } from "@/lib/use-owned-action"
import { SetRow } from "@/components/account/set-list"

/** 昵称上限按 Unicode 字符计，emoji 算一个字。 */
const NICKNAME_MAX = 32

/** 本地先按服务端同样的规则检查，返回错误文案；合格时返回 null。 */
export function nicknameError(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return "昵称不能为空"
  if (Array.from(trimmed).length > NICKNAME_MAX) return `昵称最多 ${NICKNAME_MAX} 个字`
  // 与服务端一致：不允许控制字符。
  if (/\p{Cc}/u.test(trimmed)) return "昵称不能包含控制字符"
  return null
}

function saveError(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === "INVALID_INPUT") return "昵称不符合要求，请换一个"
    if (cause.status === 401 || cause.status === 403) return "登录状态已变化，请刷新页面后重试"
  }
  return "保存失败，请稍后重试"
}

/** 平时显示昵称和「编辑」；编辑时整行变成输入框加「保存」「取消」。 */
export function NicknameRow({ me }: { me: MeResponse }) {
  const client = useQueryClient()
  const { pending, run, cancel } = useOwnedAction()
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function startEditing() {
    setDraft(me.nickname)
    setError(null)
  }
  function stopEditing() {
    cancel()
    setDraft(null)
    setError(null)
  }
  function save() {
    if (draft === null || pending) return
    const problem = nicknameError(draft)
    if (problem) {
      setError(problem)
      return
    }
    const nickname = draft.trim()
    setError(null)
    run((isCurrent) => homeApi.user.updateProfile({ nickname }, isCurrent), {
      onSuccess: (updated) => {
        client.setQueryData(["me"], updated)
        setDraft(null)
      },
      onError: (cause) => setError(saveError(cause)),
    })
  }

  if (draft === null)
    return (
      <SetRow
        icon={<PenLine />}
        title="昵称"
        description={me.nickname.trim() || "PigClaude 用户"}
        trailing={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="编辑昵称"
            onClick={startEditing}
          >
            编辑
          </Button>
        }
      />
    )
  return (
    <SetRow
      icon={<PenLine />}
      title="昵称"
      description={
        <div className="nickname-editor">
          <div className="nickname-editor-row">
            <Input
              aria-label="昵称"
              aria-invalid={error ? true : undefined}
              autoFocus
              value={draft}
              maxLength={128}
              disabled={pending}
              className="h-8 max-w-[240px] text-[13px]"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  save()
                } else if (event.key === "Escape") {
                  event.preventDefault()
                  stopEditing()
                }
              }}
            />
            <Button type="button" size="sm" disabled={pending} onClick={save}>
              {pending ? "保存中…" : "保存"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={stopEditing}>
              取消
            </Button>
          </div>
          {error && (
            <p role="alert" className="nickname-editor-error">
              {error}
            </p>
          )}
        </div>
      }
    />
  )
}
