// 用合成离线音频和 CDP 夹具检查探针的成功、失败和未决状态。
import assert from "node:assert/strict"
import test from "node:test"
import vm from "node:vm"

import {
  inspectOfflineAudioFingerprint,
  inspectOfflineAudioFingerprintViaCdp,
} from "./audio_fingerprint_browser_probe.mjs"

const expected = { requestedRate: 44100, expectedRate: 44100.00390625, timeoutMs: 25 }

// 在独立页面上下文中装配受控构造器；不会访问系统音频设备。
function harness({ positional = {}, dictionary = {}, unavailable = false } = {}) {
  const calls = []
  class FakeOfflineAudioContext {
    constructor(...args) {
      const kind = args.length === 3 ? "positional" : "dictionary"
      const settings = kind === "positional" ? positional : dictionary
      calls.push({ kind, args })
      if (settings.constructError) throw new Error("内部构造错误不应返回")
      this.kind = kind
      this.settings = settings
      this.sampleRate = settings.rate ?? expected.expectedRate
    }
    async startRendering() {
      const settings = this.settings
      if (settings.renderError) throw new Error("内部渲染错误不应返回")
      if (settings.hang) return new Promise(() => {})
      const samples = settings.samples ?? new Float32Array(128)
      return {
        sampleRate: settings.bufferRate ?? this.sampleRate,
        length: settings.length ?? 128,
        numberOfChannels: settings.channels ?? 1,
        getChannelData: () => samples,
      }
    }
  }
  const context = vm.createContext({
    OfflineAudioContext: unavailable ? undefined : FakeOfflineAudioContext,
    setTimeout,
    clearTimeout,
    ArrayBuffer,
  })
  const probe = vm.runInContext(`(${inspectOfflineAudioFingerprint.toString()})`, context)
  return { calls, context, probe }
}

test("两种构造方式按固定期望渲染单通道短静音", async () => {
  const { calls, probe } = harness()
  const result = await probe(expected)
  assert.equal(result.available, true)
  for (const kind of ["positional", "dictionary"]) {
    assert.deepEqual(JSON.parse(JSON.stringify(result[kind])), {
      status: "ok",
      contextRateMatches: true,
      bufferRateMatches: true,
      bufferRateMatchesContext: true,
      frameCountMatches: true,
      channelCountMatches: true,
      samplesSilent: true,
    })
  }
  assert.equal(result.contextRatesAgree, true)
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["positional", "dictionary"],
  )
  assert.equal(calls[0].args[2], expected.requestedRate)
  assert.equal(calls[1].args[0].sampleRate, expected.requestedRate)
  assert.doesNotMatch(JSON.stringify(result), /44100/)
})

test("期望采样率可以与请求值相同，不把零变化判为失败", async () => {
  const { probe } = harness({ positional: { rate: 44100 }, dictionary: { rate: 44100 } })
  const result = await probe({ ...expected, expectedRate: 44100 })
  assert.equal(result.positional.contextRateMatches, true)
  assert.equal(result.dictionary.bufferRateMatches, true)
  assert.equal(result.contextRatesAgree, true)
})

test("采样率、长度、通道和非静音差异分别报告", async () => {
  const { probe } = harness({
    positional: { rate: 44100 },
    dictionary: { bufferRate: 44000, length: 64, channels: 2, samples: new Float32Array([0.5]) },
  })
  const result = await probe(expected)
  assert.equal(result.positional.contextRateMatches, false)
  assert.equal(result.dictionary.contextRateMatches, true)
  assert.equal(result.dictionary.bufferRateMatches, false)
  assert.equal(result.dictionary.bufferRateMatchesContext, false)
  assert.equal(result.dictionary.frameCountMatches, false)
  assert.equal(result.dictionary.channelCountMatches, false)
  assert.equal(result.dictionary.samplesSilent, false)
  assert.equal(result.contextRatesAgree, false)
})

test("不可用、构造失败和渲染失败不被记为通过", async () => {
  const missing = await harness({ unavailable: true }).probe(expected)
  assert.equal(missing.available, false)
  assert.equal(missing.positional.status, "unavailable")
  assert.equal(missing.dictionary.bufferRateMatches, null)
  const failed = await harness({
    positional: { constructError: true },
    dictionary: { renderError: true },
  }).probe(expected)
  assert.equal(failed.positional.status, "constructor-error")
  assert.equal(failed.dictionary.status, "render-error")
  assert.equal(failed.contextRatesAgree, null)
  assert.doesNotMatch(JSON.stringify(failed), /内部/)
})

test("渲染超时保持未验证，错误采样数组保持无效状态", async () => {
  const result = await harness({ positional: { hang: true }, dictionary: { samples: [0] } }).probe({
    ...expected,
    timeoutMs: 10,
  })
  assert.equal(result.positional.status, "timeout")
  assert.equal(result.positional.samplesSilent, null)
  assert.equal(result.dictionary.status, "invalid")
  assert.equal(result.contextRatesAgree, null)
})

test("未提供精确期望时仍检查采样率一致性，不猜测扰动值", async () => {
  const { probe, context } = harness()
  const options = { requestedRate: 44100, timeoutMs: 25 }
  const result = await probe(options)
  assert.equal(result.positional.contextRateMatches, null)
  assert.equal(result.positional.bufferRateMatches, null)
  assert.equal(result.positional.bufferRateMatchesContext, true)
  assert.equal(result.contextRatesAgree, true)
  const cdp = {
    async send(_method, params) {
      return { result: { value: await vm.runInContext(params.expression, context) } }
    },
  }
  const viaCdp = await inspectOfflineAudioFingerprintViaCdp(cdp, "s", options)
  assert.equal(viaCdp.dictionary.contextRateMatches, null)
  assert.equal(viaCdp.dictionary.bufferRateMatchesContext, true)
})

test("非法期望在构造音频上下文之前被拒绝", async () => {
  const { calls, probe } = harness()
  for (const value of [
    {},
    { ...expected, expectedRate: 44100.001 },
    { ...expected, timeoutMs: 1 },
    { ...expected, extra: true },
  ]) {
    await assert.rejects(probe(value), /期望无效/)
  }
  assert.equal(calls.length, 0)
})

test("CDP 适配器在已有会话执行探针，不返回原始采样率", async () => {
  const { context } = harness()
  const calls = []
  const cdp = {
    async send(method, params, session) {
      calls.push({ method, params, session })
      return { result: { value: await vm.runInContext(params.expression, context) } }
    },
  }
  const result = await inspectOfflineAudioFingerprintViaCdp(cdp, "synthetic-session", expected)
  assert.equal(calls[0].method, "Runtime.evaluate")
  assert.equal(calls[0].session, "synthetic-session")
  assert.equal(calls[0].params.awaitPromise, true)
  assert.equal(calls[0].params.returnByValue, true)
  assert.equal(result.positional.contextRateMatches, true)
  assert.doesNotMatch(JSON.stringify(result), /44100/)
})

test("CDP 异常、额外字段和未验证却报告通过均被拒绝", async () => {
  const good = await harness().probe(expected)
  for (const value of [
    { ...good, extra: "raw" },
    { ...good, positional: { ...good.positional, contextRateMatches: "raw" } },
    { ...good, positional: { ...good.positional, status: "timeout" } },
  ]) {
    await assert.rejects(
      inspectOfflineAudioFingerprintViaCdp(
        { send: async () => ({ result: { value } }) },
        "s",
        expected,
      ),
      /返回格式无效/,
    )
  }
  await assert.rejects(
    inspectOfflineAudioFingerprintViaCdp(
      {
        send: async () => {
          throw new Error("原始内部错误")
        },
      },
      "s",
      expected,
    ),
    (error) => error.message === "离线音频探针执行失败",
  )
})

test("CDP 序列化不会静默丢弃显式指定的期望", async () => {
  let calls = 0
  const cdp = {
    async send() {
      calls += 1
    },
  }
  await assert.rejects(
    inspectOfflineAudioFingerprintViaCdp(cdp, "s", {
      requestedRate: 44100,
      expectedRate: undefined,
    }),
    /期望无效/,
  )
  assert.equal(calls, 0)
})
