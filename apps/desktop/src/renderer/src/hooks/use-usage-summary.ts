// 负责读取 usage.summary 的 today/7d 汇总；页面只消费汇总，不直接读 usage.jsonl。

import { useCallback, useEffect, useState } from "react"
import type { UsageBridge, UsageRange, UsageSummary } from "../../../main/session/session-types"
import { sessionErrorText } from "../models/session-model"

/** 用量页需要的汇总状态。 */
export type UsageSummaryController = {
  summary: UsageSummary | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/** 订阅只读用量汇总；range 变化时重新读取，失败只显示可读文案。 */
export function useUsageSummary(
  range: UsageRange,
  bridge?: UsageBridge | null,
): UsageSummaryController {
  const resolved = bridge === undefined ? window.pigclaude?.usage : bridge
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (resolved === null || resolved === undefined) {
      setSummary(null)
      setLoading(false)
      setError("用量记录不可用")
      return
    }
    setLoading(true)
    setError(null)
    try {
      setSummary(await resolved.summary({ range }))
    } catch (caught: unknown) {
      setSummary(null)
      setError(sessionErrorText(caught instanceof Error ? caught.message : "用量记录读取失败"))
    } finally {
      setLoading(false)
    }
  }, [range, resolved])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { summary, loading, error, refresh }
}
