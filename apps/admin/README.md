# PigClaude 管理后台

保留 Pigcursor 管理后台的布局、主题、表格与 Radix 交互，当前只展示用户、会员、设备绑定和安全审计四项真实能力。所有业务数据和权限继续由 Rust Admin API 返回。

- 开发：`pnpm dev:loopback`。
- API 代理：`API_PROXY_TARGET`，默认 `http://127.0.0.1:8788`。
- 返回官网：构建或启动时优先读取公开的 `VITE_HOME_URL`，其次读取 `PIGCLAUDE_HOME_URL`；默认 `http://127.0.0.1:3000`。只注入经校验的无凭据 HTTP(S) origin，去掉路径、查询和片段，不暴露其他服务端环境变量。
- 检查：`pnpm test`、`pnpm build`；在 frontend 根目录运行 `pnpm exec eslint apps/admin` 与 `pnpm exec prettier --check apps/admin`。

迁移参照固定版本 `f6ff3383a2119d7030ea2cd21b0544671ad676bd`。未迁入没有 Rust API 支持的看板统计、充值、优惠券、档位管理、账本和用户调账等入口。
