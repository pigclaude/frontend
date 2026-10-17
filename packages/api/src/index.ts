// 负责导出第一阶段共享 HTTP client 与 home/admin API 工厂。
export { ApiError, createClient } from "./client"
/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export type { ApiErrorBody, ClientOptions, HttpClient, Query } from "./client"
// 导出共享符号，保持包边界稳定。
export { createHomeApi } from "./home/endpoints"
/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export type { HomeApi } from "./home/endpoints"
// 导出共享符号，保持包边界稳定。
export { createAdminApi } from "./admin/endpoints"
/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export type { AdminApi } from "./admin/endpoints"
