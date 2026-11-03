// 用合成 DOM 核验 ClientRects 探针的偏移、豁免、清理和未验证状态。
import assert from "node:assert/strict"
import test from "node:test"
import vm from "node:vm"

import {
  inspectClientRectsFingerprint,
  inspectClientRectsFingerprintViaCdp,
} from "./clientrects_fingerprint_browser_probe.mjs"

// 控制浏览器返回的几何值，记录临时元素及清理行为。
function harness({
  offset = { x: 0, y: 0 },
  absoluteOrigin = { x: 0, y: 0 },
  mode = "ok",
  unavailable = false,
} = {}) {
  const state = { created: 0, appended: 0, removed: 0, styles: [] }
  const rect = (origin) => ({ x: origin.x, y: origin.y, width: 40, height: 20 })
  const document = {
    createElement() {
      const kind = state.created++ === 0 ? "fixed" : "absolute"
      const values = kind === "fixed" ? rect(offset) : rect(absoluteOrigin)
      const style = {}
      state.styles.push(style)
      return {
        style,
        appendChild() {},
        getBoundingClientRect() {
          if (mode === "throws") throw new Error("内部几何读取错误")
          return values
        },
        getClientRects() {
          if (mode === "no-rects") return []
          return [values]
        },
        remove() {
          state.removed += 1
          if (mode === "cleanup-error") throw new Error("内部清理错误")
        },
      }
    },
    documentElement: {
      appendChild() {
        state.appended += 1
      },
    },
  }
  const context = vm.createContext({ document: unavailable ? undefined : document })
  const probe = vm.runInContext(`(${inspectClientRectsFingerprint.toString()})`, context)
  return { probe, context, state }
}

test("固定元素偏移与绝对定位豁免分别检查并清理", () => {
  const offset = { x: Math.fround(0.00025), y: Math.fround(-0.0005) }
  const { probe, state } = harness({ offset })
  const result = probe({ offset })
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: "ok",
    cleanup: true,
    fixedRepeatStable: true,
    fixedListMatches: true,
    fixedOffsetMatches: true,
    absoluteRepeatStable: true,
    absoluteListMatches: true,
    absoluteOriginMatches: true,
    dimensionsMatch: true,
  })
  assert.equal(state.appended, 1)
  assert.equal(state.removed, 1)
  assert.match(state.styles[0].cssText, /position:fixed/)
  assert.match(state.styles[1].cssText, /position:absolute/)
  assert.doesNotMatch(JSON.stringify(result), /0\.00025/)
})

test("无独立期望时不猜测偏移；零偏移本身可以是有效结果", () => {
  const { probe } = harness()
  assert.equal(probe({}).fixedOffsetMatches, null)
  assert.equal(probe({ offset: { x: 0, y: 0 } }).fixedOffsetMatches, true)
})

test("x86 合成参考值先转为 float32 再与页面比较", () => {
  const expected = { x: -0.00052320469392538188, y: 0.00060583959743516519 }
  const offset = { x: Math.fround(expected.x), y: Math.fround(expected.y) }
  assert.notEqual(offset.x, expected.x)
  assert.equal(harness({ offset }).probe({ offset: expected }).fixedOffsetMatches, true)
})

test("普通偏移错误和绝对定位豁免错误独立报告", () => {
  const { probe } = harness({ offset: { x: 0, y: 0 }, absoluteOrigin: { x: 0.0001, y: 0 } })
  const result = probe({ offset: { x: 0.0005, y: 0 } })
  assert.equal(result.fixedOffsetMatches, false)
  assert.equal(result.absoluteOriginMatches, false)
})

test("页面不可用、几何缺失和读取异常不被当成通过", () => {
  const unavailable = harness({ unavailable: true }).probe({})
  assert.equal(unavailable.status, "unavailable")
  assert.equal(unavailable.cleanup, null)
  assert.equal(unavailable.fixedOffsetMatches, null)
  for (const [mode, status] of [
    ["no-rects", "invalid"],
    ["throws", "error"],
  ]) {
    const { probe, state } = harness({ mode })
    const result = probe({ offset: { x: 0, y: 0 } })
    assert.equal(result.status, status)
    assert.equal(result.fixedOffsetMatches, null)
    assert.equal(state.removed, 1)
    assert.doesNotMatch(JSON.stringify(result), /内部/)
  }
})

test("清理失败单独报告，非法期望在创建元素前拒绝", () => {
  const cleanup = harness({ mode: "cleanup-error" }).probe({})
  assert.equal(cleanup.status, "ok")
  assert.equal(cleanup.cleanup, false)
  const { probe, state } = harness()
  for (const value of [
    null,
    { offset: { x: 1, y: 0 } },
    { offset: { x: NaN, y: 0 } },
    { extra: true },
  ])
    assert.throws(() => probe(value), /期望无效/)
  assert.equal(state.created, 0)
})

test("通过已有 CDP 会话执行并返回合成比较结果", async () => {
  const { context } = harness()
  const calls = []
  const cdp = {
    async send(method, params, session) {
      calls.push({ method, params, session })
      return { result: { value: vm.runInContext(params.expression, context) } }
    },
  }
  const result = await inspectClientRectsFingerprintViaCdp(cdp, "synthetic", {
    offset: { x: 0, y: 0 },
  })
  assert.equal(calls[0].method, "Runtime.evaluate")
  assert.equal(calls[0].session, "synthetic")
  assert.equal(calls[0].params.returnByValue, true)
  assert.equal(result.fixedOffsetMatches, true)
})

test("CDP 拒绝额外字段、原始几何值及未知状态虚假成功", async () => {
  const good = harness().probe({})
  for (const value of [
    { ...good, x: 0.0003 },
    { ...good, fixedRepeatStable: 0.0003 },
    { ...good, status: "unavailable", cleanup: null },
    { ...good, fixedOffsetMatches: true },
  ]) {
    await assert.rejects(
      inspectClientRectsFingerprintViaCdp({ send: async () => ({ result: { value } }) }, "s", {}),
      /返回格式无效/,
    )
  }
  let calls = 0
  await assert.rejects(
    inspectClientRectsFingerprintViaCdp(
      {
        send: async () => {
          calls += 1
        },
      },
      "s",
      { offset: undefined },
    ),
    /期望无效/,
  )
  assert.equal(calls, 0)
})
