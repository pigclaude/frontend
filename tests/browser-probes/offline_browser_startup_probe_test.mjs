// 用合成 CDP 和内存 DOM 验证离线启动探针，不连接浏览器或系统服务。
import assert from "node:assert/strict"
import { test } from "node:test"
import vm from "node:vm"
import { inspectOfflineBrowserStartup } from "./offline_browser_startup_probe.mjs"

const marker = "0123456789abcdef0123456789abcdef"

function fakeCdp({ mutate } = {}) {
  const calls = []
  let url
  return {
    calls,
    async send(method, params, sessionId) {
      calls.push({ method, params, sessionId })
      if (method === "Page.navigate") {
        url = params.url
        const html = decodeURIComponent(url.split(",").slice(1).join(","))
        assert.ok(html.includes("default-src 'none'"))
        assert.ok(!html.includes("http:"))
        assert.ok(!html.includes("https:"))
        return { frameId: "synthetic-frame" }
      }
      assert.equal(method, "Runtime.evaluate")
      const context = {
        location: { href: url },
        document: {
          readyState: "complete",
          getElementById(id) {
            assert.equal(id, "pigclaude-startup")
            return { textContent: marker, getAttribute: () => "42" }
          },
        },
      }
      mutate?.(context)
      const value = await vm.runInNewContext(params.expression, context, {
        timeout: 100,
      })
      return { result: { value } }
    },
  }
}

test("只导航固定 data 页面并校验三个比较结果", async () => {
  const cdp = fakeCdp()
  assert.deepEqual(await inspectOfflineBrowserStartup(cdp, "private-session", marker), {
    ownDocument: true,
    dom: true,
    javascript: true,
    offlinePageVerified: true,
  })
  assert.deepEqual(
    cdp.calls.map(({ method }) => method),
    ["Page.navigate", "Runtime.evaluate"],
  )
  assert.ok(cdp.calls.every(({ sessionId }) => sessionId === "private-session"))
})

test("其他页面不能借相同 DOM 标记通过", async () => {
  const cdp = fakeCdp({
    mutate: (context) => (context.location.href = "about:blank"),
  })
  await assert.rejects(inspectOfflineBrowserStartup(cdp, "private-session", marker, 10), /探针超时/)
})

test("缺少 DOM 或未执行合成脚本不能算通过", async () => {
  for (const node of [null, { textContent: marker, getAttribute: () => null }]) {
    const cdp = fakeCdp({
      mutate: (context) => (context.document.getElementById = () => node),
    })
    assert.equal(
      (await inspectOfflineBrowserStartup(cdp, "private-session", marker)).offlinePageVerified,
      false,
    )
  }
})

test("文档仍在加载时有界等待下一次快照", async () => {
  let samples = 0
  const cdp = fakeCdp({
    mutate(context) {
      context.document.readyState = samples++ === 0 ? "loading" : "complete"
    },
  })
  assert.equal(
    (await inspectOfflineBrowserStartup(cdp, "private-session", marker)).offlinePageVerified,
    true,
  )
})

test("导航返回后旧上下文尚在时不读取其 DOM", async () => {
  let samples = 0
  const cdp = fakeCdp({
    mutate(context) {
      if (samples++ === 0) {
        context.location.href = "about:blank"
        context.document.getElementById = () => assert.fail("旧文档 DOM 不应读取")
      }
    },
  })
  assert.equal(
    (await inspectOfflineBrowserStartup(cdp, "private-session", marker)).offlinePageVerified,
    true,
  )
})

test("导航销毁上下文后只重试比较，不重复导航", async () => {
  const original = fakeCdp()
  let first = true
  const cdp = {
    send(method, ...rest) {
      if (method === "Runtime.evaluate" && first) {
        first = false
        return Promise.reject(new Error("synthetic context destroyed"))
      }
      return original.send(method, ...rest)
    },
  }
  assert.equal(
    (await inspectOfflineBrowserStartup(cdp, "private-session", marker)).offlinePageVerified,
    true,
  )
  assert.equal(original.calls.filter(({ method }) => method === "Page.navigate").length, 1)
})

test("导航错误不继续读取页面", async () => {
  let calls = 0
  const cdp = {
    async send() {
      calls++
      return { errorText: "synthetic-error" }
    },
  }
  await assert.rejects(inspectOfflineBrowserStartup(cdp, "private-session", marker), /导航失败/)
  assert.equal(calls, 1)
})

test("CDP 错误只返回固定分类，不传播底层错误内容", async () => {
  const cdp = {
    send: () => Promise.reject(new Error("synthetic-private-detail")),
  }
  await assert.rejects(inspectOfflineBrowserStartup(cdp, "private-session", marker), {
    message: "离线启动 CDP 命令失败",
  })
})

test("超时后不继续下一条 CDP 命令", async () => {
  let resolveNavigation
  const methods = []
  const cdp = {
    send(method) {
      methods.push(method)
      return new Promise((resolve) => (resolveNavigation = resolve))
    },
  }
  await assert.rejects(
    inspectOfflineBrowserStartup(cdp, "private-session", marker, 10),
    /调用方仍须销毁私有页面/,
  )
  resolveNavigation({ frameId: "late-frame" })
  await Promise.resolve()
  assert.deepEqual(methods, ["Page.navigate"])
})

test("异常和越界结果结构都拒绝", async () => {
  for (const response of [
    { exceptionDetails: {} },
    { result: { value: { ownDocument: true, dom: true } } },
    { result: { value: { ownDocument: 1, ready: true, dom: true, javascript: true } } },
    {
      result: {
        value: {
          ownDocument: true,
          ready: true,
          dom: true,
          javascript: true,
          extra: "unread",
        },
      },
    },
  ]) {
    const cdp = {
      async send(method) {
        return method === "Page.navigate" ? { frameId: "synthetic-frame" } : response
      },
    }
    await assert.rejects(inspectOfflineBrowserStartup(cdp, "private-session", marker), /结果无效/)
  }
})

test("无效输入在发送 CDP 命令前失败", async () => {
  const cdp = { send: () => assert.fail("不应发送命令") }
  for (const args of [
    [null, "private", marker],
    [cdp, "", marker],
    [cdp, "private", "<script>"],
    [cdp, "private", marker, 0],
  ])
    await assert.rejects(inspectOfflineBrowserStartup(...args), TypeError)
})
