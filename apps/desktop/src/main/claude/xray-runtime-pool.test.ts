// 验证 Xray 原端口恢复失败时向使用者报告错误。

import { expect, it } from "vitest"
import { createXrayRuntimePool, type StartXrayCore } from "./xray-runtime-pool"
import { XrayStartupCleanupError } from "./xray-runtime-errors"

it("并发启动相同代理时只启动一个 Xray", async () => {
  let release: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  let starts = 0
  let closes = 0
  const neverExited = new Promise<void>(() => undefined)
  const pool = createXrayRuntimePool(async () => {
    starts += 1
    await ready
    return {
      url: "socks5://127.0.0.1:12345",
      exited: neverExited,
      close: async () => {
        closes += 1
      },
    }
  }, 0)
  try {
    const first = pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
    const second = pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
    await expect.poll(() => starts).toBe(1)
    release()
    const [a, b] = await Promise.all([first, second])
    expect(a.url).toBe(b.url)
    await a.close()
    expect(closes).toBe(0)
    await b.close()
    expect(closes).toBe(1)
  } finally {
    release()
    await pool.dispose()
  }
})

it("同端口恢复期间等待新 Xray 就绪", async () => {
  let exited: () => void = () => undefined
  let releaseRestart: (runtime: Awaited<ReturnType<StartXrayCore>>) => void = () => undefined
  let observeRestart: () => void = () => undefined
  const exit = new Promise<void>((resolve) => {
    exited = resolve
  })
  const restarting = new Promise<void>((resolve) => {
    observeRestart = resolve
  })
  let starts = 0
  const pool = createXrayRuntimePool(async () => {
    starts += 1
    if (starts === 1)
      return { url: "socks5://127.0.0.1:12345", exited: exit, close: async () => undefined }
    observeRestart()
    return new Promise((resolve) => {
      releaseRestart = resolve
    })
  }, 0)
  try {
    const runtime = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
    exited()
    await restarting
    if (!runtime.ready) throw new Error("缺少 Xray 就绪检查")
    let finished = false
    const waiting = runtime.ready().then(() => {
      finished = true
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    releaseRestart({
      url: runtime.url,
      exited: new Promise<void>(() => undefined),
      close: async () => undefined,
    })
    await waiting
    expect(finished).toBe(true)
    await runtime.close()
  } finally {
    releaseRestart({
      url: "socks5://127.0.0.1:12345",
      exited: new Promise<void>(() => undefined),
      close: async () => undefined,
    })
    await pool.dispose()
  }
})

it("恢复失败时通知所有使用相同代理的实例", async () => {
  let exited: () => void = () => undefined
  const exit = new Promise<void>((resolve) => {
    exited = resolve
  })
  let starts = 0
  const calls: Array<{ upstreamProxyUrl: string; port?: number }> = []
  const startCore: StartXrayCore = async (input) => {
    calls.push(input)
    starts += 1
    if (starts > 1) throw new Error("原端口不可用")
    return { url: "socks5://127.0.0.1:12345", exited: exit, close: async () => undefined }
  }
  const pool = createXrayRuntimePool(startCore, 0)
  try {
    const first = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
    const second = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
    exited()
    await expect(first.failure).resolves.toMatchObject({ code: "PROXY_UNAVAILABLE" })
    await expect(second.failure).resolves.toMatchObject({ code: "PROXY_UNAVAILABLE" })
    await first.close()
    await second.close()
    expect(starts).toBe(2)
    expect(calls).toEqual([
      { upstreamProxyUrl: "http://127.0.0.1:9" },
      { upstreamProxyUrl: "http://127.0.0.1:9", port: 12345 },
    ])
  } finally {
    await pool.dispose()
  }
})

it("没有使用者时 Xray 退出不再重启", async () => {
  let exited: () => void = () => undefined
  const exit = new Promise<void>((resolve) => {
    exited = resolve
  })
  let starts = 0
  const pool = createXrayRuntimePool(async () => {
    starts += 1
    return { url: "socks5://127.0.0.1:12345", exited: exit, close: async () => undefined }
  }, 1_000)
  try {
    const runtime = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
    await runtime.close()
    exited()
    await Promise.resolve()
    expect(starts).toBe(1)
  } finally {
    await pool.dispose()
  }
})

it("最后一个使用者释放后恢复失败，不留下无法回收的记录", async () => {
  let exited: () => void = () => undefined
  let rejectRestart: (error: Error) => void = () => undefined
  let observeRestart: () => void = () => undefined
  const exit = new Promise<void>((resolve) => {
    exited = resolve
  })
  const restarting = new Promise<void>((resolve) => {
    observeRestart = resolve
  })
  let starts = 0
  const pool = createXrayRuntimePool(async () => {
    starts += 1
    if (starts === 1)
      return { url: "socks5://127.0.0.1:12345", exited: exit, close: async () => undefined }
    observeRestart()
    return new Promise((_resolve, reject) => {
      rejectRestart = reject
    })
  }, 20)
  const runtime = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
  exited()
  await restarting
  await runtime.close()
  rejectRestart(new Error("恢复失败"))
  await new Promise((resolve) => setTimeout(resolve, 50))
  await expect(pool.dispose()).resolves.toBeUndefined()
})

it("最后一个引用关闭失败时，可重试同一引用的清理", async () => {
  let closes = 0
  const pool = createXrayRuntimePool(
    async () => ({
      url: "socks5://127.0.0.1:12345",
      exited: new Promise<void>(() => undefined),
      close: async () => {
        closes += 1
        if (closes === 1) throw new Error("关闭失败")
      },
    }),
    0,
  )
  const runtime = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
  await expect(runtime.close()).rejects.toThrow("关闭失败")
  await expect(runtime.close()).resolves.toBeUndefined()
  expect(closes).toBe(2)
  await expect(pool.dispose()).resolves.toBeUndefined()
})

it("同一代理正在回收时，新使用者等待结果；回收失败不启动新进程", async () => {
  let release: () => void = () => undefined
  let entered: () => void = () => undefined
  const closing = new Promise<void>((resolve) => {
    entered = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let starts = 0
  let closes = 0
  const pool = createXrayRuntimePool(async () => {
    starts += 1
    return {
      url: `socks5://127.0.0.1:${12344 + starts}`,
      exited: new Promise<void>(() => undefined),
      close: async () => {
        closes += 1
        if (closes === 1) {
          entered()
          await gate
          throw new Error("关闭失败")
        }
        if (closes === 2) throw new Error("关闭仍未完成")
      },
    }
  }, 0)
  const first = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
  const closeResult = first.close().catch((error: unknown) => error)
  await closing
  const nextResult = pool({ upstreamProxyUrl: "http://127.0.0.1:9" }).catch(
    (error: unknown) => error,
  )
  try {
    await Promise.resolve()
    expect(starts).toBe(1)
    release()
    expect(await closeResult).toBeInstanceOf(Error)
    expect(await nextResult).toBeInstanceOf(Error)
    await expect(pool({ upstreamProxyUrl: "http://127.0.0.1:9" })).rejects.toMatchObject({
      code: "PROXY_UNAVAILABLE",
    })
    await first.close()
    const next = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
    expect(starts).toBe(2)
    await next.close()
  } finally {
    release()
    await Promise.allSettled([closeResult, nextResult])
    await pool.dispose()
  }
})

it("启动失败且回收未确认时，不为同一代理再启动 Xray", async () => {
  let starts = 0
  let cleanupAllowed = false
  const pool = createXrayRuntimePool(async () => {
    starts += 1
    throw new XrayStartupCleanupError(async () => {
      if (!cleanupAllowed) throw new Error("回收未完成")
    })
  }, 0)
  try {
    await expect(pool({ upstreamProxyUrl: "http://127.0.0.1:9" })).rejects.toMatchObject({
      code: "PROXY_UNAVAILABLE",
    })
    await expect(pool({ upstreamProxyUrl: "http://127.0.0.1:9" })).rejects.toMatchObject({
      code: "PROXY_UNAVAILABLE",
    })
    expect(starts).toBe(1)
    cleanupAllowed = true
    await expect(pool({ upstreamProxyUrl: "http://127.0.0.1:9" })).rejects.toMatchObject({
      code: "PROXY_UNAVAILABLE",
    })
    expect(starts).toBe(2)
  } finally {
    cleanupAllowed = true
    await pool.dispose()
  }
})

it("恢复失败且回收未确认时，不为同一代理再启动 Xray", async () => {
  let exit: () => void = () => undefined
  const exited = new Promise<void>((resolve) => {
    exit = resolve
  })
  let starts = 0
  let cleanupAllowed = false
  const pool = createXrayRuntimePool(async () => {
    starts += 1
    if (starts === 1)
      return { url: "socks5://127.0.0.1:12345", exited, close: async () => undefined }
    if (starts === 2)
      throw new XrayStartupCleanupError(async () => {
        if (!cleanupAllowed) throw new Error("回收未完成")
      })
    return {
      url: "socks5://127.0.0.1:12346",
      exited: new Promise<void>(() => undefined),
      close: async () => undefined,
    }
  }, 0)
  try {
    const runtime = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
    exit()
    await expect(runtime.failure).resolves.toMatchObject({ code: "PROXY_UNAVAILABLE" })
    await expect(runtime.close()).rejects.toThrow()
    await expect(pool({ upstreamProxyUrl: "http://127.0.0.1:9" })).rejects.toMatchObject({
      code: "PROXY_UNAVAILABLE",
    })
    expect(starts).toBe(2)
    cleanupAllowed = true
    await runtime.close()
    const next = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
    expect(starts).toBe(3)
    await next.close()
  } finally {
    cleanupAllowed = true
    await pool.dispose()
  }
})

it("Xray 退出未确认时，清理成功前不启动同一代理", async () => {
  let rejectExit: (error: Error) => void = () => undefined
  const exited = new Promise<void>((_resolve, reject) => {
    rejectExit = reject
  })
  let starts = 0
  let cleanupAllowed = false
  const pool = createXrayRuntimePool(async () => {
    starts += 1
    if (starts === 1)
      return {
        url: "socks5://127.0.0.1:12345",
        exited,
        close: async () => {
          if (!cleanupAllowed) throw new Error("退出未确认")
        },
      }
    return {
      url: "socks5://127.0.0.1:12346",
      exited: new Promise<void>(() => undefined),
      close: async () => undefined,
    }
  }, 0)
  try {
    const runtime = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
    rejectExit(new Error("退出未确认"))
    await expect(runtime.failure).resolves.toMatchObject({ code: "PROXY_UNAVAILABLE" })
    await expect(runtime.close()).rejects.toThrow()
    await expect(pool({ upstreamProxyUrl: "http://127.0.0.1:9" })).rejects.toMatchObject({
      code: "PROXY_UNAVAILABLE",
    })
    expect(starts).toBe(1)
    cleanupAllowed = true
    await runtime.close()
    const next = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
    expect(starts).toBe(2)
    await next.close()
  } finally {
    cleanupAllowed = true
    await pool.dispose()
  }
})

it("关闭过程中恢复失败且回收未确认时，不能报告关闭成功", async () => {
  let exit: () => void = () => undefined
  let rejectRestart: (error: Error) => void = () => undefined
  let observeRestart: () => void = () => undefined
  const exited = new Promise<void>((resolve) => {
    exit = resolve
  })
  const restarting = new Promise<void>((resolve) => {
    observeRestart = resolve
  })
  let starts = 0
  let cleanupAllowed = false
  const pool = createXrayRuntimePool(async () => {
    starts += 1
    if (starts === 1)
      return { url: "socks5://127.0.0.1:12345", exited, close: async () => undefined }
    observeRestart()
    return new Promise((_resolve, reject) => {
      rejectRestart = reject
    })
  }, 0)
  const runtime = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
  exit()
  await restarting
  const closing = pool.dispose()
  rejectRestart(
    new XrayStartupCleanupError(async () => {
      if (!cleanupAllowed) throw new Error("回收未完成")
    }),
  )
  await expect(closing).rejects.toMatchObject({ code: "PROXY_UNAVAILABLE" })
  cleanupAllowed = true
  await expect(pool.dispose()).resolves.toBeUndefined()
  await runtime.close()
})

it("新使用者与旧引用并发清理失败后，旧引用仍可重试", async () => {
  let exit: () => void = () => undefined
  let release: () => void = () => undefined
  let observe: () => void = () => undefined
  const exited = new Promise<void>((resolve) => {
    exit = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const cleaning = new Promise<void>((resolve) => {
    observe = resolve
  })
  let starts = 0
  let cleanups = 0
  let allowCleanup = false
  const pool = createXrayRuntimePool(async () => {
    starts += 1
    if (starts === 1)
      return { url: "socks5://127.0.0.1:12345", exited, close: async () => undefined }
    if (starts === 2)
      throw new XrayStartupCleanupError(async () => {
        cleanups += 1
        if (!allowCleanup) {
          observe()
          await gate
          throw new Error("回收未完成")
        }
      })
    return {
      url: "socks5://127.0.0.1:12346",
      exited: new Promise<void>(() => undefined),
      close: async () => undefined,
    }
  }, 0)
  const runtime = await pool({ upstreamProxyUrl: "http://127.0.0.1:9" })
  exit()
  await runtime.failure
  const acquiring = pool({ upstreamProxyUrl: "http://127.0.0.1:9" }).catch(
    (error: unknown) => error,
  )
  await cleaning
  const closing = runtime.close().catch((error: unknown) => error)
  try {
    release()
    expect(await acquiring).toBeInstanceOf(Error)
    expect(await closing).toBeInstanceOf(Error)
    allowCleanup = true
    await runtime.close()
    expect(cleanups).toBe(2)
  } finally {
    release()
    allowCleanup = true
    await Promise.allSettled([acquiring, closing])
    await pool.dispose()
  }
})
