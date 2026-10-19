// 负责 Home 构建与敏感请求日志隔离；API 由固定目标 Route Handler 保留 Host。
import path from "node:path"
import type { NextConfig } from "next"

/** 固定服务端代理不使用会改写 Host 的 Next external rewrites。 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  logging: {
    incomingRequests: { ignore: [/^\/(?:oauth2|v1|identity|\.well-known)(?:\/|\?|$)/] },
  },
}
export default nextConfig
