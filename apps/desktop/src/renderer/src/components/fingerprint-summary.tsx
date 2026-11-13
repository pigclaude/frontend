// 负责按分组展示账号指纹摘要：身份、设备、兼容伪装和高级原始参数。

import { SettingRow, SettingSection } from "@pigclaude/ui-primitives"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { fingerprintSummaryGroups, normalizeFingerprintForm } from "../models/fingerprint-form"

/** 指纹摘要 props。fallbackSeed 用于旧记录只保存了种子字符串的情况。 */
export type FingerprintSummaryProps = {
  fingerprint?: ClaudeFingerprintView | undefined
  fallbackSeed?: string | undefined
}

/** 渲染分组指纹摘要。保证空值显示为「跟随默认」而不是空白。 */
export function FingerprintSummary({ fingerprint, fallbackSeed }: FingerprintSummaryProps) {
  const value = normalizeFingerprintForm(fingerprint)
  const resolved =
    value.seed === "" && fallbackSeed !== undefined && fallbackSeed !== ""
      ? { ...value, seed: fallbackSeed }
      : value
  return (
    <>
      {fingerprintSummaryGroups(resolved).map((group) => (
        <div key={group.id} aria-label={group.title}>
          <SettingSection title={group.title}>
            {group.rows.map((row) => (
              <SettingRow
                key={row.label}
                title={row.label}
                description={row.block ? <code>{row.value}</code> : undefined}
                value={row.block ? undefined : row.value}
              />
            ))}
          </SettingSection>
          {group.note === undefined ? null : <p className="section-note">{group.note}</p>}
        </div>
      ))}
    </>
  )
}
