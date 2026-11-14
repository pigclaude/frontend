// 验证发版的 tag 核对：推 tag 时 tag 必须与桌面端版本一致，手动触发只接受测试 tag。
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

type ReleaseTarget = {
  releaseTarget(input: { event: string; pushedTag?: string; testTag?: string; version: string }): {
    tag: string
    version: string
    test: boolean
  }
}

const check = createRequire(import.meta.url)(
  resolve(import.meta.dirname, "../../release-target.cjs"),
) as ReleaseTarget

describe("发版的 tag 和版本", () => {
  it("推 v<桌面端版本> 时正式发布", () => {
    expect(check.releaseTarget({ event: "push", pushedTag: "v1.2.3", version: "1.2.3" })).toEqual({
      tag: "v1.2.3",
      version: "1.2.3",
      test: false,
    })
  })

  it("tag 与桌面端版本不一致时失败", () => {
    expect(() =>
      check.releaseTarget({ event: "push", pushedTag: "v1.2.4", version: "1.2.3" }),
    ).toThrow("tag v1.2.4 与桌面端版本 1.2.3 不一致")
  })

  it("手动触发只做测试发布，tag 必须是测试 tag", () => {
    expect(
      check.releaseTarget({
        event: "workflow_dispatch",
        testTag: "desktop-v0.0.0-test.1",
        version: "0.0.1",
      }),
    ).toEqual({ tag: "desktop-v0.0.0-test.1", version: "0.0.1", test: true })
    expect(() =>
      check.releaseTarget({ event: "workflow_dispatch", testTag: "v0.0.1", version: "0.0.1" }),
    ).toThrow("测试发布的 tag")
  })
})
