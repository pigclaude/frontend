// 负责将固定认证和业务命名空间代理到受信后端，保留浏览器网站 Host。
import { createBackendProxy } from "@/lib/backend-proxy"
/** OAuth 和 Cookie 响应逐请求处理，不进入页面缓存。 */
export const dynamic = "force-dynamic"
/** 使用 Node HTTP 保留 Host 和原始多 Cookie 边界。 */
export const runtime = "nodejs"
const handle = createBackendProxy(process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8788")
/** 保留 GET 方法、状态和服务器接续，不跟随后端重定向。 */
export const GET = handle
/** 保留 POST 方法、状态和服务器接续，不跟随后端重定向。 */
export const POST = handle
/** 保留 PUT 方法、状态和服务器接续，不跟随后端重定向。 */
export const PUT = handle
/** 保留 PATCH 方法、状态和服务器接续，不跟随后端重定向。 */
export const PATCH = handle
/** 保留 DELETE 方法、状态和服务器接续，不跟随后端重定向。 */
export const DELETE = handle
/** 保留 HEAD 方法、状态和服务器接续，不跟随后端重定向。 */
export const HEAD = handle
/** 保留 OPTIONS 方法、状态和服务器接续，不跟随后端重定向。 */
export const OPTIONS = handle
