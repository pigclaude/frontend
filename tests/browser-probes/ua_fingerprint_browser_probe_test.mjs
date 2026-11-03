// 验证 UA/客户端提示探针的结果边界；所有页面和 Worker 数据均为合成夹具。
import assert from "node:assert/strict"
import test from "node:test"
import vm from "node:vm"
import { Worker as ThreadWorker } from "node:worker_threads"

import { inspectUaFingerprint } from "./ua_fingerprint_browser_probe.mjs"

const expected = {
  userAgentIncludes: ["Chrome/125."],
  userAgentExcludes: ["HeadlessChrome"],
  platform: "Win32",
  lowEntropy: {
    platform: "Windows",
    mobile: false,
    brands: [{ brand: "Chromium", version: "125" }],
  },
  highEntropy: {
    architecture: "x86",
    platformVersion: "19.0.0",
    fullVersionList: [{ brand: "Chromium", version: "125.2.3.4" }],
  },
  timeoutMs: 100,
}

// 构造固定的合成 UA 数据，允许单独注入不同字段或高熵返回行为。
function makeNavigator({
  ua = "Synthetic Chrome/125.0.0.0",
  platform = "Win32",
  hints = true,
  low = {},
  high = {},
  highMode = "ok",
} = {}) {
  const nav = { userAgent: ua, platform }
  if (hints) {
    nav.userAgentData = {
      platform: "Windows",
      mobile: false,
      brands: [
        { brand: "Grease", version: "99" },
        { brand: "Chromium", version: "125" },
      ],
      ...low,
      async getHighEntropyValues(keys) {
        if (highMode === "reject") throw new Error("不应返回的内部错误")
        if (highMode === "hang") return new Promise(() => {})
        const source = {
          architecture: "x86",
          platformVersion: "19.0.0",
          fullVersionList: [
            { brand: "Grease", version: "99.0.0.0" },
            { brand: "Chromium", version: "125.2.3.4" },
          ],
          ...high,
        }
        return Object.fromEntries(
          keys.filter((key) => key in source).map((key) => [key, source[key]]),
        )
      },
    }
  }
  return nav
}

// 用独立 VM 执行浏览器 Worker 源码，模拟结构化交付和资源清理。
function makeHarness({
  page = makeNavigator(),
  worker = makeNavigator(),
  mode = "ok",
  payload,
  cleanupThrows = false,
} = {}) {
  const blobs = new Map()
  const state = { revoked: 0, terminated: 0, workerReads: 0 }
  class FakeBlob {
    constructor(parts) {
      this.source = parts.join("")
    }
  }
  const fakeURL = {
    createObjectURL(blob) {
      blobs.set("blob:synthetic", blob.source)
      return "blob:synthetic"
    },
    revokeObjectURL(url) {
      state.revoked += 1
      blobs.delete(url)
    },
  }
  class FakeWorker {
    constructor(url) {
      if (mode === "constructor-error") throw new Error("不应暴露的构造错误")
      this.stopped = false
      const scope = {
        navigator: worker,
        postMessage: (value) => {
          if (!this.stopped) this.onmessage?.({ data: payload ?? value })
        },
      }
      const context = vm.createContext({ self: scope })
      vm.runInContext(blobs.get(url), context, { timeout: 1000 })
      this.scope = scope
    }
    postMessage(keys) {
      if (mode === "worker-hang") return
      queueMicrotask(() => {
        if (this.stopped) return
        state.workerReads += 1
        try {
          Promise.resolve(this.scope.onmessage({ data: keys })).catch(() => this.onerror?.())
        } catch {
          this.onerror?.()
        }
      })
    }
    terminate() {
      state.terminated += 1
      this.stopped = true
      if (cleanupThrows) throw new Error("不应暴露的清理错误")
    }
  }
  const context = vm.createContext({
    navigator: page,
    Worker: mode === "worker-unavailable" ? undefined : FakeWorker,
    Blob: FakeBlob,
    URL: mode === "url-unavailable" ? undefined : fakeURL,
    setTimeout,
    clearTimeout,
  })
  const probe = vm.runInContext(`(${inspectUaFingerprint.toString()})`, context, { timeout: 1000 })
  return { probe, state }
}

test("页面和 Worker 的合成 UA、客户端提示与期望一致，品牌顺序可不同", async () => {
  const worker = makeNavigator({
    low: {
      brands: [
        { brand: "Chromium", version: "125" },
        { brand: "Grease", version: "99" },
      ],
    },
    high: {
      fullVersionList: [
        { brand: "Chromium", version: "125.2.3.4" },
        { brand: "Grease", version: "99.0.0.0" },
      ],
    },
  })
  const { probe, state } = makeHarness({ worker })
  const result = await probe(expected)
  assert.equal(result.page.userAgentExpected, true)
  assert.equal(result.page.platformExpected, true)
  assert.equal(result.page.hintsAvailable, true)
  assert.equal(result.page.hintsPlatformExpected, true)
  assert.equal(result.page.hintsMobileExpected, true)
  assert.equal(result.page.hintsBrandsExpected, true)
  assert.equal(result.page.highEntropyStatus, "ok")
  assert.equal(result.page.highEntropyExpected.architecture, true)
  assert.equal(result.page.highEntropyExpected.platformVersion, true)
  assert.equal(result.page.highEntropyExpected.fullVersionList, true)
  assert.equal(result.worker.status, "ok")
  assert.equal(result.worker.cleanup, true)
  assert.equal(result.worker.userAgentMatchesPage, true)
  assert.equal(result.worker.platformMatchesPage, true)
  assert.equal(result.worker.hintsBrandsMatchPage, true)
  assert.equal(result.worker.highEntropyMatchesPage.fullVersionList, true)
  assert.equal(state.revoked, 1)
  assert.equal(state.terminated, 1)
  assert.doesNotMatch(JSON.stringify(result), /Synthetic|Win32|Chromium|19\.0\.0|125\.2\.3\.4/)
})

test("UA 或 Worker 值不一致时只把相应项目标记为失败", async () => {
  const { probe } = makeHarness({
    page: makeNavigator({ ua: "Synthetic HeadlessChrome/125.0.0.0" }),
    worker: makeNavigator({ platform: "Linux x86_64", high: { architecture: "arm" } }),
  })
  const result = await probe(expected)
  assert.equal(result.page.userAgentExpected, false)
  assert.equal(result.page.platformExpected, true)
  assert.equal(result.worker.userAgentMatchesPage, false)
  assert.equal(result.worker.platformMatchesPage, false)
  assert.equal(result.worker.highEntropyMatchesPage.architecture, false)
})

test("客户端提示不可用时保留未决值，不把两个缺失视为匹配", async () => {
  const { probe } = makeHarness({
    page: makeNavigator({ hints: false }),
    worker: makeNavigator({ hints: false }),
  })
  const result = await probe(expected)
  assert.equal(result.page.hintsAvailable, false)
  assert.equal(result.page.hintsBrandsExpected, null)
  assert.equal(result.page.highEntropyStatus, "unavailable")
  assert.equal(result.page.highEntropyExpected.architecture, null)
  assert.equal(result.worker.hintsAvailabilityMatchesPage, null)
  assert.equal(result.worker.highEntropyMatchesPage.architecture, null)
})

test("只在一侧缺少客户端提示时报告能力不一致", async () => {
  const { probe } = makeHarness({ worker: makeNavigator({ hints: false }) })
  const result = await probe(expected)
  assert.equal(result.worker.status, "ok")
  assert.equal(result.worker.hintsAvailabilityMatchesPage, false)
  assert.equal(result.worker.hintsBrandsMatchPage, null)
})

test("高熵字段未返回或类型错误分别报告未决与失败", async () => {
  const { probe } = makeHarness({
    page: makeNavigator({ high: { architecture: undefined, platformVersion: 19 } }),
  })
  const result = await probe(expected)
  assert.equal(result.page.highEntropyStatus, "ok")
  assert.equal(result.page.highEntropyExpected.architecture, null)
  assert.equal(result.page.highEntropyExpected.platformVersion, false)
})

test("高熵请求拒绝时不泄露异常，也不报告通过", async () => {
  const { probe } = makeHarness({ page: makeNavigator({ highMode: "reject" }) })
  const result = await probe(expected)
  assert.equal(result.page.highEntropyStatus, "error")
  assert.equal(result.page.highEntropyExpected.architecture, null)
  assert.doesNotMatch(JSON.stringify(result), /内部错误/)
})

test("Worker 或 URL 接口不可用时保留未验证状态", async () => {
  for (const mode of ["worker-unavailable", "url-unavailable"]) {
    const { probe } = makeHarness({ mode })
    const result = await probe(expected)
    assert.equal(result.worker.status, "unavailable")
    assert.equal(result.worker.cleanup, null)
    assert.equal(result.worker.userAgentMatchesPage, null)
  }
})

test("Worker 创建失败仍释放已创建的 URL", async () => {
  const { probe, state } = makeHarness({ mode: "constructor-error" })
  const result = await probe(expected)
  assert.equal(result.worker.status, "error")
  assert.equal(result.worker.cleanup, true)
  assert.equal(state.revoked, 1)
  assert.equal(state.terminated, 0)
})

test("页面高熵请求和 Worker 卡住时有界返回并清理", async () => {
  const { probe, state } = makeHarness({
    page: makeNavigator({ highMode: "hang" }),
    mode: "worker-hang",
  })
  const result = await probe({ ...expected, timeoutMs: 20 })
  assert.equal(result.page.highEntropyStatus, "timeout")
  assert.equal(result.page.highEntropyExpected.architecture, null)
  assert.equal(result.worker.status, "timeout")
  assert.equal(result.worker.cleanup, true)
  assert.equal(state.revoked, 1)
  assert.equal(state.terminated, 1)
})

test("Worker 结果不完整或清理失败时不隐藏异常状态", async () => {
  for (const payload of [{}, { low: {}, high: {} }]) {
    const invalid = await makeHarness({ payload }).probe(expected)
    assert.equal(invalid.worker.status, "invalid")
    assert.equal(invalid.worker.userAgentMatchesPage, null)
  }
  const cleanup = await makeHarness({ cleanupThrows: true }).probe(expected)
  assert.equal(cleanup.worker.status, "ok")
  assert.equal(cleanup.worker.cleanup, false)
})

test("期望无效时在读取任何 UA 前拒绝", async () => {
  let reads = 0
  const page = {
    get userAgent() {
      reads += 1
      return "secret"
    },
  }
  const { probe, state } = makeHarness({ page })
  await assert.rejects(probe({}), /期望无效/)
  await assert.rejects(
    probe({
      lowEntropy: {
        brands: [
          { brand: "Chromium", version: "125" },
          { brand: "Chromium", version: "125" },
        ],
      },
    }),
    /期望无效/,
  )
  assert.equal(reads, 0)
  assert.equal(state.workerReads, 0)
})

test("合成 Worker 脚本可在真实 Node 工作线程中收发并清理", async () => {
  const blobs = new Map()
  let thread, termination
  class TestBlob {
    constructor(parts) {
      this.source = parts.join("")
    }
  }
  const fakeURL = {
    createObjectURL(blob) {
      blobs.set("blob:thread", blob.source)
      return "blob:thread"
    },
    revokeObjectURL(url) {
      blobs.delete(url)
    },
  }
  class ThreadAdapter {
    constructor(url) {
      const bootstrap = `
        const {parentPort, workerData} = require('node:worker_threads');
        const hints = {
          platform: 'Windows', mobile: false,
          brands: [{brand: 'Grease', version: '99'}, {brand: 'Chromium', version: '125'}],
          async getHighEntropyValues(keys) {
            const values = {architecture: 'x86', platformVersion: '19.0.0',
              fullVersionList: [{brand: 'Grease', version: '99.0.0.0'},
                                {brand: 'Chromium', version: '125.2.3.4'}]};
            return Object.fromEntries(keys.filter(key => key in values).map(key => [key, values[key]]));
          },
        };
        globalThis.self = {
          navigator: {userAgent: 'Synthetic Chrome/125.0.0.0', platform: 'Win32', userAgentData: hints},
          postMessage: value => parentPort.postMessage(value),
        };
        (0, eval)(workerData.source);
        parentPort.on('message', data => self.onmessage({data}));
      `
      thread = new ThreadWorker(bootstrap, { eval: true, workerData: { source: blobs.get(url) } })
      thread.on("message", (data) => this.onmessage?.({ data }))
      thread.on("error", () => this.onerror?.({ preventDefault() {} }))
    }
    postMessage(value) {
      thread.postMessage(value)
    }
    terminate() {
      termination = thread.terminate()
    }
  }
  const context = vm.createContext({
    navigator: makeNavigator(),
    Worker: ThreadAdapter,
    Blob: TestBlob,
    URL: fakeURL,
    setTimeout,
    clearTimeout,
  })
  const probe = vm.runInContext(`(${inspectUaFingerprint.toString()})`, context, { timeout: 1000 })
  try {
    const result = await probe({ ...expected, timeoutMs: 2000 })
    assert.equal(result.worker.status, "ok")
    assert.equal(result.worker.userAgentMatchesPage, true)
    assert.equal(result.worker.hintsBrandsMatchPage, true)
    assert.equal(result.worker.highEntropyMatchesPage.platformVersion, true)
    assert.equal(result.worker.cleanup, true)
    assert.equal(blobs.size, 0)
  } finally {
    if (thread) await (termination ?? thread.terminate())
  }
})
