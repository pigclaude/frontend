// 负责用户站当前会话的异步请求代次，退出后旧结果不再交付。
import { createWebSessionGeneration } from "@pigclaude/api/web-oidc"
/** 仅用于本网站当前页面生命周期，不作为服务端认证材料。 */
export const homeSessionGeneration = createWebSessionGeneration()
