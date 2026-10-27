// 负责从安装包公共元数据和显式环境变量解析桌面服务端点，不读取任何服务端秘密。

/** 桌面主进程可使用的无凭据 HTTP(S) 服务 origin。 */
export type DesktopRuntimeEndpoints = {
  rustBaseUrl: string
  authOrigin: string
  websiteOrigin: string
}

/** 保证环境覆盖优先，其次使用 bundle 公共配置，最后兼容旧本地开发默认值。 */
export function readDesktopRuntimeEndpoints(
  env: Record<string, string | undefined>,
  bundleMetadata?: unknown,
): DesktopRuntimeEndpoints {
  const bundled = readBundledEndpoints(bundleMetadata)
  const authOrigin = readOrigin(
    env["PIGCLAUDE_AUTH_ORIGIN"] ?? bundled?.authOrigin ?? "http://127.0.0.1:3000",
  )
  return {
    rustBaseUrl: readOrigin(
      env["PIGCLAUDE_RUST_BASE_URL"] ?? bundled?.rustBaseUrl ?? "http://127.0.0.1:8788",
    ),
    authOrigin,
    websiteOrigin: readOrigin(
      env["PIGCLAUDE_WEBSITE_ORIGIN"] ?? bundled?.websiteOrigin ?? authOrigin,
    ),
  }
}

function readBundledEndpoints(
  metadata: unknown,
): (Omit<DesktopRuntimeEndpoints, "websiteOrigin"> & { websiteOrigin?: string }) | undefined {
  if (!isRecord(metadata) || !("pigclaudeEndpoints" in metadata)) return undefined
  const endpoints = metadata.pigclaudeEndpoints
  if (!isRecord(endpoints)) throw new Error("安装包公共端点配置无效")
  return {
    rustBaseUrl: readOrigin(endpoints.rustBaseUrl),
    authOrigin: readOrigin(endpoints.authOrigin),
    ...(endpoints.websiteOrigin === undefined
      ? {}
      : { websiteOrigin: readOrigin(endpoints.websiteOrigin) }),
  }
}

function readOrigin(value: unknown): string {
  if (typeof value !== "string" || !/^https?:\/\/[^/?#\s]+\/?$/i.test(value)) {
    throw new Error("桌面服务端点必须是无凭据的 HTTP(S) origin")
  }
  const url = new URL(value)
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("桌面服务端点必须是无凭据的 HTTP(S) origin")
  }
  return url.origin
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
