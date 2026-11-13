桌面端用 electron-vite 管理，目录和 pigcursor 一样：

- `src/main` 创建窗口，以后在这里拉起 daemon 和 Claude 进程
- `src/preload` 只暴露命令和事件，不传递凭据
- `src/renderer` 是页面。`index.html` 在这一层，React 代码在 `src/renderer/src`。渲染进程不读凭据、不起进程

## 开发期自定义供应商

未打包运行时，`src/main/session/dev-provider.ts` 会读三个环境变量，把会话直接接到 Anthropic 兼容供应商：

- `PIGCLAUDE_DEV_PROVIDER_BASE_URL`：供应商地址，必须是 http(s)
- `PIGCLAUDE_DEV_PROVIDER_AUTH_TOKEN`：供应商 token
- `PIGCLAUDE_DEV_PROVIDER_MODEL`：可省略。给了就固定模型，界面只显示这一项

覆盖只替换会话的地址、token 和模型，因此该模式下不要求本机有可用的 Claude 账号；会员门禁和 daemon
就绪检查照常生效，打包构建完全忽略这些变量。

验证方式：`PIGCLAUDE_DEV_PROVIDER_* pnpm --filter @pigclaude/desktop dev`。要在自动化脚本里操作窗口，
另外加 `--remote-debugging-port=<port>` 并用 Playwright 的 `connectOverCDP` 连接；不要用
Playwright 的 `_electron.launch`，那样 safeStorage 拿不到系统钥匙串里的原密钥，会员门禁会报
`SAFE_STORAGE_UNAVAILABLE`。
