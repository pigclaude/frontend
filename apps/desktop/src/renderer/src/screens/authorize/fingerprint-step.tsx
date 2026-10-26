// 负责授权向导里的指纹步骤：持有草稿、显示字段级错误并在通过校验后提交完整指纹。

import { useState } from "react"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { FingerprintForm } from "../../components/fingerprint-form"
import { Button } from "../../components/ui/button"
import {
  hasFingerprintFormErrors,
  normalizeFingerprintForm,
  validateFingerprintForm,
  type FingerprintFormErrors,
} from "../../models/fingerprint-form"

/** 指纹步骤 props。initialFingerprint 作为草稿初始值，提交前会归一化。 */
export type FingerprintStepProps = {
  initialFingerprint: ClaudeFingerprintView
  submitLabel: string
  error?: string | null
  idPrefix?: string
  onSubmit: (fingerprint: ClaudeFingerprintView) => void
  onBack?: () => void
}

/** 渲染指纹步骤；校验失败时停留在本步骤并显示字段级错误。 */
export function FingerprintStep({
  initialFingerprint,
  submitLabel,
  error,
  idPrefix = "authorize",
  onSubmit,
  onBack,
}: FingerprintStepProps) {
  const [draft, setDraft] = useState(() => normalizeFingerprintForm(initialFingerprint))
  const [errors, setErrors] = useState<FingerprintFormErrors>({})

  function submit(): void {
    const normalized = normalizeFingerprintForm(draft)
    const nextErrors = validateFingerprintForm(normalized)
    setErrors(nextErrors)
    if (hasFingerprintFormErrors(nextErrors)) return
    onSubmit(normalized)
  }

  return (
    <div className="wizard-body">
      <div>
        <h1>设定这个账号的指纹</h1>
        <p className="sub">
          指纹保存在本机这个账号下，以后重新授权都用同一份。留空的字段跟随 AntBrowser 默认值。
        </p>
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <FingerprintForm
        value={draft}
        errors={errors}
        idPrefix={idPrefix}
        onChange={(next) => {
          setDraft(next)
          // 用户开始修改后清掉旧错误，避免提示停留在已经改过的字段上。
          if (hasFingerprintFormErrors(errors)) setErrors({})
        }}
      />
      <div className="wizard-foot">
        {onBack === undefined ? null : (
          <Button variant="ghost" onClick={onBack}>
            返回上一步
          </Button>
        )}
        <Button variant="primary" onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
