// 负责按分组展示账号指纹摘要：身份、设备、兼容伪装和高级原始参数。

import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { fingerprintSummaryGroups, normalizeFingerprintForm } from "../models/fingerprint-form"

/** 指纹摘要 props。fallbackSeed 用于旧记录只保存了种子字符串的情况。 */
export type FingerprintSummaryProps = {
  fingerprint?: ClaudeFingerprintView
  fallbackSeed?: string
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
        <div className="section" key={group.id} aria-label={group.title}>
          <div className="section-head">
            <h2>{group.title}</h2>
          </div>
          <div className="group">
            {group.rows.map((row) => (
              <div className="item" key={row.label}>
                <div className="main">
                  <div className="ttl">{row.label}</div>
                  {row.block ? <div className="desc mono">{row.value}</div> : null}
                </div>
                {row.block ? null : <span className="val">{row.value}</span>}
              </div>
            ))}
          </div>
          {group.note === undefined ? null : <p className="note">{group.note}</p>}
        </div>
      ))}
    </>
  )
}
