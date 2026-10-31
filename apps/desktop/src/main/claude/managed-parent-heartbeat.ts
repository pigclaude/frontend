// 负责在受管通道上发送父进程心跳；调用方仍须验证内核与控制端身份。

import type { Writable } from "node:stream"

const heartbeatIntervalMs = 1_000
const maximumProtocolInteger = 2_147_483_647

/** 心跳绑定的通道、会话和代次；调用方须先确认策略已安装。 */
export type ManagedParentHeartbeatInput = {
  channel: Writable
  session: string
  generation: number
}

/** 发送有序心跳；不可写、积压或停止时销毁通道，返回的停止函数可重复调用。 */
export function startManagedParentHeartbeat(input: ManagedParentHeartbeatInput): () => void {
  const { channel, session, generation } = input
  if (
    !/^[0-9a-f]{64}$/.test(session) ||
    !Number.isInteger(generation) ||
    generation < 1 ||
    generation > maximumProtocolInteger
  ) {
    throw new Error("受管心跳参数无效")
  }
  if (channel.destroyed) return () => undefined
  let stopped = false
  let sequence = 0
  let timer: ReturnType<typeof setInterval> | undefined

  const close = () => {
    if (stopped) return
    stopped = true
    if (timer !== undefined) clearInterval(timer)
    channel.destroy()
  }
  const onError = () => close()
  const onFinish = () => close()
  const onClose = () => {
    close()
    channel.off("error", onError)
    channel.off("finish", onFinish)
    channel.off("close", onClose)
  }
  const send = () => {
    if (stopped) return
    if (
      channel.destroyed ||
      !channel.writable ||
      channel.writableEnded ||
      channel.writableLength !== 0 ||
      sequence >= maximumProtocolInteger
    ) {
      close()
      return
    }
    sequence += 1
    const frame = `${JSON.stringify({ type: "heartbeat", version: 2, session, generation, sequence })}\n`
    try {
      if (
        !channel.write(frame, (error) => {
          if (error) close()
        })
      )
        close()
    } catch {
      close()
    }
  }
  channel.on("error", onError)
  channel.on("finish", onFinish)
  channel.on("close", onClose)
  send()
  if (!stopped) {
    timer = setInterval(send, heartbeatIntervalMs)
    timer.unref()
  }
  return close
}
