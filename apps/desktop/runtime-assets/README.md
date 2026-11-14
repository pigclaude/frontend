# 桌面运行资源

桌面使用 `pigbrowser/pigbrowser` 已交付的 Chromium `156.0.8078.88` 开发包和独立 Xray。
三平台开发包、压缩包摘要、文件清单摘要与入口固定在
[`pigbrowser-artifacts.json`](../pigbrowser-artifacts.json)。这是集成用开发产物，正式发布及安装态验收另行完成。

三个原始包是 `pigbrowser/pigbrowser` 的 Release `v<版本>` 的附件（不能是草稿），附件名与 `archive` 完全一致。
有该仓库读权限时，先在环境里设置 `PIGBROWSER_READ_TOKEN`（例如 `export PIGBROWSER_READ_TOKEN="$(gh auth token)"`），
再从 frontend 根目录运行 `node apps/desktop/download-pigbrowser.cjs --target <平台> --dir <目录>`
下载并核对 SHA-256。发布工作流用同一个脚本，令牌取 frontend 的 secret `PIGBROWSER_READ_TOKEN`。

先将对应压缩包的 SHA-256 与固定值核对，再按原格式解压。macOS 使用 `ditto -x -k`，保留完整应用、权限和符号链接；Windows 使用 ZIP 解压，Linux 使用 `tar -xf`。
从 frontend 根目录运行：

```sh
node apps/desktop/stage-pigbrowser.cjs \
  --package /absolute/path/to/unpacked/pigbrowser-development-package \
  --target darwin-arm64
```

`--package` 指向直接包含 `manifest.json` 的目录；另外两个目标为 `win32-x64` 和 `linux-x64`。
准备工具核对固定清单及全部内容，复制完整开发包，并在复制后再次校验；已有目标目录会明确报错，需先核对并移走旧资源。
开发包中的许可证、第三方声明和构建来源随包保留。资源目录不提交到 Git。

| 平台        | PigBrowser 可执行文件（相对 `pigclaude-runtime/`）             | Xray 可执行文件           |
| ----------- | -------------------------------------------------------------- | ------------------------- |
| macOS arm64 | `pigbrowser/darwin-arm64/Chromium.app/Contents/MacOS/Chromium` | `xray/darwin-arm64/xray`  |
| Windows x64 | `pigbrowser/win32-x64/browser/chrome.exe`                      | `xray/win32-x64/xray.exe` |
| Linux x64   | `pigbrowser/linux-x64/browser/chrome`                          | `xray/linux-x64/xray`     |

开发启动也读取本目录准备好的浏览器。需要使用独立构建时，显式设置
`PIGCLAUDE_PIGBROWSER_BIN` 为完整 PigBrowser 产物中的可执行文件绝对路径；该开发覆盖路径只检查二进制格式与架构，不能代替完整包校验。
旧的 `PIGCLAUDE_FINGERPRINT_CHROMIUM_BIN` 和系统安装的上游浏览器不再作为定位来源。

打包前重新核对目标 PigBrowser 的完整清单，以及 Xray 和构建后的守护程序是否存在。
Xray 的资源完整性、正式版本与安装态验收仍需分别完成；应用启动时检查所选二进制的格式和宿主架构。
平台验证工作流通过手动触发接收两个固定包的下载地址，下载后按仓库固定摘要和清单核验，不自动替换为旧上游版本。

账号 profile 继续保存在原来的 `local/browser-profiles/<accountId>`，浏览器资源切换不迁移或清空它。
代理由桌面管理 Xray；桌面继续传入自己的冲突检查、禁止非代理 UDP、精确 localhost 回调旁路及 DNS 参数。
用户正常安装的扩展保留原生行为。Chromium 156 会在下一次启动时清理通过 `Extensions.loadUnpacked` 调试接口安装的扩展；该接口不能用来制作原生持久安装的验收证据。
