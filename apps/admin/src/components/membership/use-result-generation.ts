// 负责将已完成的会员查询结果绑定到不可复用的输入与会话代次。
import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { adminSessionGeneration } from "@/lib/session-generation"
/** 每次 scope 或会话转换都生成新身份，返回旧内容不会恢复旧身份。 */
export function useResultGeneration(scope: string) {
  const session = adminSessionGeneration.current()
  const [stored, setStored] = useState({ scope, session, version: 0 })
  let generation = stored
  if (stored.scope !== scope || stored.session !== session) {
    generation = { scope, session, version: stored.version + 1 }
    setStored(generation)
  }
  const active = useRef<typeof generation | null>(null)
  useLayoutEffect(() => {
    active.current = generation
    return () => {
      active.current = null
    }
  }, [generation])
  const isCurrent = useCallback(
    () => active.current === generation && adminSessionGeneration.current() === generation.session,
    [generation],
  )
  return { generation, isCurrent }
}
