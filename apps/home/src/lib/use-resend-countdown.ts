// 负责「N 秒后重发」倒计时，发码成功或被限流后由调用方按服务端给的秒数启动。
"use client"

import { useCallback, useEffect, useState } from "react"

/** 返回剩余秒数、启动和清零函数；剩余秒数为 0 表示可以再次发送。 */
export function useResendCountdown() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (seconds <= 0) return
    const timer = window.setTimeout(() => setSeconds((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [seconds])
  const start = useCallback((value: number) => setSeconds(Math.max(0, Math.ceil(value))), [])
  const reset = useCallback(() => setSeconds(0), [])
  return { seconds, start, reset }
}
