// 负责集中定义管理后台在本地开发时连接 Rust server 的 loopback 默认值。

/** Task 7 Rust server 的默认 HTTP listener，保持所有本地服务只绑定 loopback。 */
export const DEFAULT_RUST_API_TARGET = "http://127.0.0.1:8788"
