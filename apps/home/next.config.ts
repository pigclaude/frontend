// 负责配置 home 的 Next.js 构建和 Rust API 反向代理。
import path from "node:path"
import type { NextConfig } from "next"

const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8788"

/** 返回 home 的 Next 配置，浏览器请求保持同源 cookie。 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${apiTarget}/v1/:path*` },
      { source: "/authorize/:flowId/approve", destination: "/authorize/:flowId" },
    ]
  },
}

export default nextConfig
