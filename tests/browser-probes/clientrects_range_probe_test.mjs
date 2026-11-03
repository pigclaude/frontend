// 验证 Range 几何探针的有界比较、定位独立性和清理行为。
import assert from "node:assert/strict"
import test from "node:test"
import vm from "node:vm"

import {
  inspectClientRangeFingerprint,
  inspectClientRangeFingerprintViaCdp,
} from "./clientrects_fingerprint_browser_probe.mjs"

function harness({
  boundingOffset = { x: 0, y: 0 },
  listOffset = boundingOffset,
  listWidth = 40,
  mode = "ok",
  unavailable = false,
} = {}) {
  const state = { created: 0, appended: 0, removed: 0, selected: 0, detached: 0, styles: [] }
  const rect = (origin, width = 40) => ({ x: origin.x, y: origin.y, width, height: 20 })
  const document = {
    createElement() {
      state.created += 1
      const style = {}
      state.styles.push(style)
      return {
        style,
        appendChild() {},
        remove() {
          state.removed += 1
          if (mode === "remove-error") throw new Error("内部移除错误")
        },
      }
    },
    documentElement: {
      appendChild() {
        state.appended += 1
      },
    },
    createRange: unavailable
      ? undefined
      : () => ({
          selectNode() {
            state.selected += 1
          },
          getBoundingClientRect() {
            if (mode === "throws") throw new Error("内部读取错误")
            return rect(boundingOffset)
          },
          getClientRects() {
            return mode === "no-rects" ? [] : [rect(listOffset, listWidth)]
          },
          detach() {
            state.detached += 1
            if (mode === "detach-error") throw new Error("内部清理错误")
          },
        }),
  }
  const context = vm.createContext({ document })
  const probe = vm.runInContext(`(${inspectClientRangeFingerprint.toString()})`, context)
  return { probe, context, state }
}

test("选中绝对定位元素的 Range 按独立期望检查并清理", () => {
  const expected = { x: -0.00052320469392538188, y: 0.00060583959743516519 }
  const offset = { x: Math.fround(expected.x), y: Math.fround(expected.y) }
  const { probe, state } = harness({ boundingOffset: offset })
  const result = probe({ offset: expected })
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: "ok",
    cleanup: true,
    boundingRepeatStable: true,
    listRepeatStable: true,
    originsAgree: true,
    boundingOffsetMatches: true,
    listOffsetMatches: true,
    geometryNonEmpty: true,
  })
  assert.equal(state.selected, 1)
  assert.equal(state.removed, 1)
  assert.equal(state.detached, 1)
  assert.match(state.styles[1].cssText, /position:absolute/)
})

test("未提供独立偏移时保留未知；退化尺寸由结果显式标记", () => {
  const result = harness({ listWidth: 0 }).probe({})
  assert.equal(result.status, "ok")
  assert.equal(result.boundingOffsetMatches, null)
  assert.equal(result.listOffsetMatches, null)
  assert.equal(result.geometryNonEmpty, false)
})

test("两种 Range API 的坐标独立检查，不要求浮点宽度逐位相同", () => {
  const offset = { x: Math.fround(0.0002), y: Math.fround(-0.0004) }
  const { probe } = harness({
    boundingOffset: offset,
    listOffset: { x: 0, y: 0 },
    listWidth: 40.000003814697266,
  })
  const result = probe({ offset })
  assert.equal(result.boundingOffsetMatches, true)
  assert.equal(result.listOffsetMatches, false)
  assert.equal(result.originsAgree, false)
  assert.equal(result.geometryNonEmpty, true)
})

test("不存在、几何缺失与异常均保持未验证并释放节点", () => {
  const unavailable = harness({ unavailable: true }).probe({})
  assert.equal(unavailable.status, "unavailable")
  assert.equal(unavailable.cleanup, null)
  for (const [mode, status] of [
    ["no-rects", "invalid"],
    ["throws", "error"],
  ]) {
    const { probe, state } = harness({ mode })
    const result = probe({ offset: { x: 0, y: 0 } })
    assert.equal(result.status, status)
    assert.equal(result.boundingOffsetMatches, null)
    assert.equal(state.removed, 1)
    assert.equal(state.detached, 1)
    assert.doesNotMatch(JSON.stringify(result), /内部/)
  }
})

test("Range 清理失败单独报告，非法期望不创建节点", () => {
  const cleanup = harness({ mode: "detach-error" }).probe({})
  assert.equal(cleanup.status, "ok")
  assert.equal(cleanup.cleanup, false)
  const { probe, state } = harness()
  assert.throws(() => probe({ offset: { x: 2, y: 0 } }), /期望无效/)
  assert.throws(() => probe({ offset: { x: 0 } }), /期望无效/)
  assert.equal(state.created, 0)
})

test("通过已有 CDP 会话执行并验证三态输出", async () => {
  const { context } = harness()
  const calls = []
  const cdp = {
    async send(method, params, session) {
      calls.push({ method, params, session })
      return { result: { value: vm.runInContext(params.expression, context) } }
    },
  }
  const result = await inspectClientRangeFingerprintViaCdp(cdp, "synthetic", {
    offset: { x: 0, y: 0 },
  })
  assert.equal(calls[0].method, "Runtime.evaluate")
  assert.equal(calls[0].session, "synthetic")
  assert.equal(result.boundingOffsetMatches, true)
  assert.equal(result.listOffsetMatches, true)
})

test("CDP 拒绝附带原始坐标或未验证却报告成功的结果", async () => {
  const good = harness().probe({})
  for (const value of [
    { ...good, x: 0.0003 },
    { ...good, boundingRepeatStable: 0.0003 },
    { ...good, status: "unavailable", cleanup: null },
    { ...good, boundingOffsetMatches: true },
  ]) {
    await assert.rejects(
      inspectClientRangeFingerprintViaCdp({ send: async () => ({ result: { value } }) }, "s", {}),
      /返回格式无效/,
    )
  }
})
