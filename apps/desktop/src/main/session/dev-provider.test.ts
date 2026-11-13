// 负责验证开发期供应商覆盖：打包构建永远关闭、地址和 token 校验、固定模型时的单项目录与启动日志。

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  devProviderAuthTokenVar,
  devProviderBaseUrlVar,
  devProviderHostOptions,
  devProviderModelVar,
  providerModelCatalog,
  readDevProviderOverride,
} from "./dev-provider"

const baseUrl = "https://provider.example.test"
const authToken = "provider-token-xyz"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("readDevProviderOverride", () => {
  it("打包构建里即使设置了变量也返回 null", () => {
    expect(
      readDevProviderOverride(
        {
          [devProviderBaseUrlVar]: baseUrl,
          [devProviderAuthTokenVar]: authToken,
          [devProviderModelVar]: "claude-haiku-5.5",
        },
        true,
      ),
    ).toBeNull()
  })

  it("缺少 token 或地址不是 http(s) 时返回 null", () => {
    expect(readDevProviderOverride({ [devProviderBaseUrlVar]: baseUrl }, false)).toBeNull()
    expect(
      readDevProviderOverride(
        { [devProviderBaseUrlVar]: "file:///tmp/provider", [devProviderAuthTokenVar]: authToken },
        false,
      ),
    ).toBeNull()
    expect(
      readDevProviderOverride(
        { [devProviderBaseUrlVar]: "not a url", [devProviderAuthTokenVar]: authToken },
        false,
      ),
    ).toBeNull()
  })

  it("去掉首尾空白，未设置模型时保留 null", () => {
    expect(
      readDevProviderOverride(
        {
          [devProviderBaseUrlVar]: ` ${baseUrl} `,
          [devProviderAuthTokenVar]: ` ${authToken} `,
          [devProviderModelVar]: "  ",
        },
        false,
      ),
    ).toEqual({ baseUrl, authToken, model: null })
  })
})

describe("providerModelCatalog", () => {
  it("固定模型时返回唯一的默认项", () => {
    expect(providerModelCatalog({ baseUrl, authToken, model: "claude-haiku-5.5" })).toEqual([
      {
        id: "claude-haiku-5.5",
        displayName: "claude-haiku-5.5",
        description: "开发期自定义供应商",
        isDefault: true,
      },
    ])
  })

  it("没有覆盖或没有固定模型时返回 null", () => {
    expect(providerModelCatalog(null)).toBeNull()
    expect(providerModelCatalog({ baseUrl, authToken, model: null })).toBeNull()
  })
})

describe("devProviderHostOptions", () => {
  it("启用时给出 provider 且日志不包含地址和 token", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const options = devProviderHostOptions(false, {
      [devProviderBaseUrlVar]: baseUrl,
      [devProviderAuthTokenVar]: authToken,
      [devProviderModelVar]: "claude-haiku-5.5",
    })

    expect(options.provider).toEqual({ baseUrl, authToken, model: "claude-haiku-5.5" })
    const logged = warn.mock.calls.flat().join(" ")
    expect(logged).toContain("claude-haiku-5.5")
    expect(logged).not.toContain(baseUrl)
    expect(logged).not.toContain(authToken)
  })

  it("未启用时返回空对象且不写日志", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    expect(devProviderHostOptions(true, {})).toEqual({})
    expect(warn).not.toHaveBeenCalled()
  })
})
