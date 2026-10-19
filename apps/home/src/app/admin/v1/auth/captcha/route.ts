// 负责中央 Admin 登录的公开验证码配置代理，不开放管理员 Cookie 业务路径。
import { createBackendProxy } from "@/lib/backend-proxy"
/** 验证码配置按请求读取。 */
export const dynamic = "force-dynamic"
/** 使用固定服务器后端及 Node HTTP。 */
export const runtime = "nodejs"
/** 只代理此公开 GET，不提供管理员业务路由。 */
export const GET = createBackendProxy(process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8788")
