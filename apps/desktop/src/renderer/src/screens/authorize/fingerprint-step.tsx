// 负责授权向导里的指纹步骤：受控草稿、字段级错误和通过校验后提交完整指纹。
// 草稿由 AuthorizeScreen 持有，返回网络出口再回来时不会丢失未保存的修改。

import { useState } from "react"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { FingerprintForm } from "../../components/fingerprint-form"
import { Button } from "../../components/ui/button"
import {
  hasFingerprintFormErrors,
  prepareFingerprintSubmission,
  type FingerprintFormErrors,
} from "../../models/fingerprint-form"

/** 指纹步骤 props。value 由授权页持有，onChange 只更新草稿。 */
export type FingerprintStepProps = {
  value: ClaudeFingerprintView
  submitLabel: string
  error?: string | null
  idPrefix?: string
  onChange: (fingerprint: ClaudeFingerprintView) => void
  onSubmit: (fingerprint: ClaudeFingerprintView) => void
  onBack?: (() => void) | undefined
}

/** 渲染指纹步骤；校验失败时停留在本步骤并显示字段级错误。 */
export function FingerprintStep({
  value,
  submitLabel,
  error,
  idPrefix = "authorize",
  onChange,
  onSubmit,
  onBack,
}: FingerprintStepProps) {
  const [errors, setErrors] = useState<FingerprintFormErrors>({})

  function submit(): void {
    const result = prepareFingerprintSubmission(value)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    onSubmit(result.fingerprint)
  }

  return (
    <div className="wizard-body">
      <div>
        <h1>设置浏览器指纹</h1>
        <p className="sub">为这个账号配置独立的浏览器环境，也可以直接使用默认设置。</p>
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <FingerprintForm
        value={value}
        errors={errors}
        idPrefix={idPrefix}
        onChange={(next) => {
          onChange(next)
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
