// 验证桌面侧只发送本次会话的有界心跳，并在通道不再可写时失败关闭。

import { PassThrough, Writable } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"
import { startManagedParentHeartbeat } from "./managed-parent-heartbeat"

const cleanup: Array<() => void> = []

afterEach(() => {
  for (const close of cleanup.splice(0)) close()
  vi.useRealTimers()
})

describe("受管浏览器父进程心跳", () => {
  it("sends only ordered session-bound heartbeats after it is started", async () => {
    vi.useFakeTimers()
    const channel = new PassThrough()
    const frames: string[] = []
    channel.on("data", (chunk: Buffer) => frames.push(chunk.toString("utf8")))
    cleanup.push(startManagedParentHeartbeat({ channel, session: "a".repeat(64), generation: 143 }))
    expect(frames).toHaveLength(1)
    expect(JSON.parse(frames[0] ?? "")).toEqual({
      type: "heartbeat",
      version: 2,
      session: "a".repeat(64),
      generation: 143,
      sequence: 1,
    })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(frames.map((frame) => JSON.parse(frame).sequence)).toEqual([1, 2, 3])
    expect(frames.every((frame) => frame.endsWith("\n") && !frame.includes("password"))).toBe(true)
    cleanup[0]?.()
    expect(channel.destroyed).toBe(true)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(frames).toHaveLength(3)
  })

  it.each([
    { session: "A".repeat(64), generation: 1 },
    { session: "a".repeat(63), generation: 1 },
    { session: "a".repeat(64), generation: 0 },
    { session: "a".repeat(64), generation: 2_147_483_648 },
  ])("rejects invalid session or generation without writing", ({ session, generation }) => {
    const channel = new PassThrough()
    const frames: string[] = []
    channel.on("data", (chunk: Buffer) => frames.push(chunk.toString("utf8")))
    expect(() => startManagedParentHeartbeat({ channel, session, generation })).toThrow(
      "受管心跳参数无效",
    )
    expect(frames).toEqual([])
    channel.destroy()
  })

  it("destroys the channel if a heartbeat cannot be written without buffering", () => {
    const channel = new Writable({ highWaterMark: 1, write: () => undefined })
    const stop = startManagedParentHeartbeat({ channel, session: "b".repeat(64), generation: 9 })
    cleanup.push(stop)
    expect(channel.destroyed).toBe(true)
  })

  it("does not retain listeners when started repeatedly on an already closed channel", async () => {
    const channel = new PassThrough()
    const closed = new Promise<void>((resolve) => channel.once("close", resolve))
    channel.destroy()
    await closed
    const before = ["error", "finish", "close"].map((event) => channel.listenerCount(event))
    for (let attempt = 0; attempt < 3; attempt += 1) {
      cleanup.push(
        startManagedParentHeartbeat({ channel, session: "d".repeat(64), generation: 11 }),
      )
    }
    expect(["error", "finish", "close"].map((event) => channel.listenerCount(event))).toEqual(
      before,
    )
  })

  it("closes the channel if a previously accepted write fails asynchronously", async () => {
    const channel = new Writable({
      write: (_chunk, _encoding, callback) =>
        queueMicrotask(() => callback(new Error("synthetic"))),
    })
    const closed = new Promise<void>((resolve) => channel.once("close", resolve))
    cleanup.push(startManagedParentHeartbeat({ channel, session: "c".repeat(64), generation: 10 }))
    await closed
    expect(channel.destroyed).toBe(true)
  })
})
