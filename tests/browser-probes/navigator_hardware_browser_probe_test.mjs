// 用合成页面与 Worker 数据核验硬件指纹探针，不读取本机硬件信息。
import assert from "node:assert/strict"
import test from "node:test"
import vm from "node:vm"
import { Worker as ThreadWorker } from "node:worker_threads"

import {
  inspectNavigatorHardware,
  inspectNavigatorHardwareViaCdp,
} from "./navigator_hardware_browser_probe.mjs"

const expected = { hardwareConcurrency: 16, deviceMemory: 32, webdriver: false, timeoutMs: 50 }

// 在各自的 VM 中执行页面和动态 Worker，显式记录资源清理。
function harness({
  page = { hardwareConcurrency: 16, deviceMemory: 32, webdriver: false },
  worker = { hardwareConcurrency: 16, deviceMemory: 32 },
  mode = "ok",
  payload,
  cleanupThrows = false,
} = {}) {
  const blobs = new Map()
  const state = { revoked: 0, terminated: 0 }
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
      if (cleanupThrows) throw new Error("内部释放错误")
    },
  }
  class FakeWorker {
    constructor(url) {
      if (mode === "constructor-error") throw new Error("内部构造错误")
      const scope = {
        navigator: worker,
        postMessage: (value) => this.onmessage?.({ data: payload ?? value }),
      }
      vm.runInNewContext(blobs.get(url), { self: scope })
      this.scope = scope
    }
    postMessage() {
      if (mode === "hang") return
      queueMicrotask(() => {
        if (mode === "error") this.onerror?.({ preventDefault() {} })
        else this.scope.onmessage({ data: null })
      })
    }
    terminate() {
      state.terminated += 1
    }
  }
  const context = vm.createContext({
    navigator: page,
    Worker: mode === "unavailable" ? undefined : FakeWorker,
    Blob: FakeBlob,
    URL: fakeURL,
    setTimeout,
    clearTimeout,
  })
  const probe = vm.runInContext(`(${inspectNavigatorHardware.toString()})`, context)
  return { state, context, probe }
}

test("页面、Worker 与合成硬件期望一致并清理资源", async () => {
  const { probe, state } = harness()
  const result = await probe(expected)
  assert.deepEqual(JSON.parse(JSON.stringify(result.page)), {
    hardwareStatus: "ok",
    memoryStatus: "ok",
    webdriverStatus: "ok",
    hardwareExpected: true,
    memoryExpected: true,
    webdriverExpected: true,
  })
  assert.equal(result.worker.status, "ok")
  assert.equal(result.worker.hardwareExpected, true)
  assert.equal(result.worker.memoryExpected, true)
  assert.equal(result.worker.hardwareMatchesPage, true)
  assert.equal(result.worker.memoryMatchesPage, true)
  assert.equal(result.worker.cleanup, true)
  assert.deepEqual(state, { revoked: 1, terminated: 1 })
  assert.doesNotMatch(JSON.stringify(result), /\b16\b|\b32\b/)
})

test("显式并发数 0 被按值比较，而非当作缺失", async () => {
  const { probe } = harness({
    page: { hardwareConcurrency: 0 },
    worker: { hardwareConcurrency: 0 },
  })
  const result = await probe({ hardwareConcurrency: 0, timeoutMs: 50 })
  assert.equal(result.page.hardwareExpected, true)
  assert.equal(result.worker.hardwareExpected, true)
  assert.equal(result.worker.hardwareMatchesPage, true)
  assert.equal(result.page.memoryExpected, null)
})

test("字段不一致与 webdriver 差异分别报告", async () => {
  const { probe } = harness({ worker: { hardwareConcurrency: 8, deviceMemory: 16 } })
  const result = await probe({ ...expected, webdriver: true })
  assert.equal(result.page.webdriverExpected, false)
  assert.equal(result.worker.hardwareExpected, false)
  assert.equal(result.worker.memoryExpected, false)
  assert.equal(result.worker.hardwareMatchesPage, false)
  assert.equal(result.worker.memoryMatchesPage, false)
})

test("设备内存不可用时保持未知，不把两侧缺失当一致", async () => {
  const { probe } = harness({
    page: { hardwareConcurrency: 16, webdriver: false },
    worker: { hardwareConcurrency: 16 },
  })
  const result = await probe(expected)
  assert.equal(result.page.memoryStatus, "unavailable")
  assert.equal(result.worker.memoryStatus, "unavailable")
  assert.equal(result.page.memoryExpected, null)
  assert.equal(result.worker.memoryMatchesPage, null)
})

test("读取错误保持未知，类型错误报告不匹配", async () => {
  const page = { deviceMemory: "invalid", webdriver: false }
  Object.defineProperty(page, "hardwareConcurrency", {
    get() {
      throw new Error("内部读取错误")
    },
  })
  const { probe } = harness({ page })
  const result = await probe(expected)
  assert.equal(result.page.hardwareStatus, "error")
  assert.equal(result.page.hardwareExpected, null)
  assert.equal(result.worker.hardwareMatchesPage, null)
  assert.equal(result.page.memoryStatus, "invalid")
  assert.equal(result.page.memoryExpected, false)
  assert.equal(result.worker.memoryMatchesPage, false)
  assert.doesNotMatch(JSON.stringify(result), /内部/)
})

test("Worker 不可用、构造失败、异常和超时均不冒充通过", async () => {
  for (const [mode, status, cleanup] of [
    ["unavailable", "unavailable", null],
    ["constructor-error", "error", true],
    ["error", "error", true],
    ["hang", "timeout", true],
  ]) {
    const { probe, state } = harness({ mode })
    const result = await probe({ ...expected, timeoutMs: 10 })
    assert.equal(result.worker.status, status)
    assert.equal(result.worker.cleanup, cleanup)
    assert.equal(result.worker.hardwareExpected, null)
    assert.equal(state.revoked, mode === "unavailable" ? 0 : 1)
  }
})

test("不完整结果和清理失败被显式报告", async () => {
  const invalid = await harness({ payload: { hardware: { status: "ok", value: 16 } } }).probe(
    expected,
  )
  assert.equal(invalid.worker.status, "invalid")
  assert.equal(invalid.worker.memoryMatchesPage, null)
  const cleanup = await harness({ cleanupThrows: true }).probe(expected)
  assert.equal(cleanup.worker.status, "ok")
  assert.equal(cleanup.worker.cleanup, false)
})

test("非法期望在创建 Worker 前拒绝", async () => {
  const { probe, state } = harness()
  for (const item of [
    {},
    { hardwareConcurrency: -1 },
    { deviceMemory: NaN },
    { webdriver: "false" },
    { ...expected, timeoutMs: 1 },
  ]) {
    await assert.rejects(probe(item), /期望无效/)
  }
  assert.deepEqual(state, { revoked: 0, terminated: 0 })
})

test("CDP 适配器使用现有会话并约束返回结构", async () => {
  const { context } = harness()
  const calls = []
  const cdp = {
    async send(method, params, session) {
      calls.push({ method, params, session })
      return { result: { value: await vm.runInContext(params.expression, context) } }
    },
  }
  const result = await inspectNavigatorHardwareViaCdp(cdp, "synthetic", expected)
  assert.equal(calls[0].method, "Runtime.evaluate")
  assert.equal(calls[0].session, "synthetic")
  assert.equal(calls[0].params.awaitPromise, true)
  assert.equal(result.worker.hardwareMatchesPage, true)
  assert.doesNotMatch(JSON.stringify(result), /\b16\b|\b32\b/)
})

test("CDP 拒绝原始值、虚假成功和序列化丢字段", async () => {
  const good = await harness().probe(expected)
  const values = [
    { ...good, hardware: 16 },
    { ...good, page: { ...good.page, hardwareExpected: 16 } },
    { ...good, worker: { ...good.worker, status: "timeout" } },
    { ...good, page: { ...good.page, memoryStatus: "unavailable" } },
  ]
  for (const value of values) {
    await assert.rejects(
      inspectNavigatorHardwareViaCdp({ send: async () => ({ result: { value } }) }, "s", expected),
      /返回格式无效/,
    )
  }
  let calls = 0
  await assert.rejects(
    inspectNavigatorHardwareViaCdp(
      {
        send: async () => {
          calls += 1
        },
      },
      "s",
      { hardwareConcurrency: undefined },
    ),
    /期望无效/,
  )
  assert.equal(calls, 0)
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
        globalThis.self = {
          navigator: {hardwareConcurrency: 16, deviceMemory: 32},
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
    navigator: { hardwareConcurrency: 16, deviceMemory: 32, webdriver: false },
    Worker: ThreadAdapter,
    Blob: TestBlob,
    URL: fakeURL,
    setTimeout,
    clearTimeout,
  })
  const probe = vm.runInContext(`(${inspectNavigatorHardware.toString()})`, context)
  try {
    const result = await probe({ ...expected, timeoutMs: 2000 })
    assert.equal(result.worker.status, "ok")
    assert.equal(result.worker.hardwareMatchesPage, true)
    assert.equal(result.worker.memoryMatchesPage, true)
    assert.equal(result.worker.cleanup, true)
    assert.equal(blobs.size, 0)
  } finally {
    if (thread) await (termination ?? thread.terminate())
  }
})
