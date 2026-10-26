// 负责账号详情里的指纹编辑弹层：完整指纹表单、字段级校验和完整对象回调。

import { useEffect, useRef, useState } from "react"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import type { PoolAccount } from "../fixtures/pool-fixtures"
import {
  hasFingerprintFormErrors,
  normalizeFingerprintForm,
  prepareFingerprintSubmission,
  type FingerprintFormErrors,
} from "../models/fingerprint-form"
import { FingerprintForm } from "./fingerprint-form"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog"

/** 指纹编辑弹层 props；保存时回调完整指纹对象。 */
export type FingerprintDialogProps = {
  open: boolean
  account: PoolAccount | null
  onOpenChange: (open: boolean) => void
  onConfirm: (fingerprint: ClaudeFingerprintView) => void
}

/** 渲染完整指纹编辑弹层。保证只在弹层从关闭变成打开时初始化草稿。 */
export function FingerprintDialog({
  open,
  account,
  onOpenChange,
  onConfirm,
}: FingerprintDialogProps) {
  const [draft, setDraft] = useState<ClaudeFingerprintView>(() => initialDraft(account))
  const [errors, setErrors] = useState<FingerprintFormErrors>({})
  const wasOpen = useRef(false)

  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      return
    }
    if (wasOpen.current) return
    wasOpen.current = true
    setDraft(initialDraft(account))
    setErrors({})
  }, [open, account])

  function confirm(): void {
    const result = prepareFingerprintSubmission(draft)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    onConfirm(result.fingerprint)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="wide">
        <div className="dialog-head">
          <DialogTitle>编辑「{account?.name ?? "账号"}」的指纹</DialogTitle>
          <DialogDescription>
            保存后下次重新授权使用同一份指纹，已有的登录不受影响。留空的字段跟随 AntBrowser 默认值。
          </DialogDescription>
        </div>
        <div className="dialog-body">
          <FingerprintForm
            value={draft}
            errors={errors}
            idPrefix="fingerprint-dialog"
            onChange={(next) => {
              setDraft(next)
              if (hasFingerprintFormErrors(errors)) setErrors({})
            }}
          />
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={confirm}>
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 从账号记录生成草稿：完整指纹优先，旧记录只用看起来像种子的字符串兜底。 */
function initialDraft(account: PoolAccount | null): ClaudeFingerprintView {
  const draft = normalizeFingerprintForm(account?.fingerprintDetail)
  if (draft.seed === "") {
    const fallback = account?.fingerprint ?? ""
    if (/^\d+$/.test(fallback)) draft.seed = fallback
  }
  return draft
}
