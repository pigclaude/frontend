// 负责 Home 构建、敏感请求日志隔离和旧账户页重定向；API 由固定目标 Route Handler 保留 Host。
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
  // 旧的账户页地址统一跳到个人中心；临时重定向，避免浏览器长期缓存。
  async redirects() {
    return [
      { source: "/dashboard", destination: "/account", permanent: false },
      { source: "/settings/security", destination: "/account/security", permanent: false },
      { source: "/settings/devices", destination: "/account/devices", permanent: false },
    ]
  },
}
export default nextConfig
