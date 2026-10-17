桌面端用 electron-vite 管理，目录和 pigcursor 一样：

- `src/main` 创建窗口，以后在这里拉起 daemon 和 Claude 进程
- `src/preload` 只暴露命令和事件，不传递凭据
- `src/renderer` 是页面。`index.html` 在这一层，React 代码在 `src/renderer/src`。渲染进程不读凭据、不起进程
