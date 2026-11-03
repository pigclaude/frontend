# 桌面运行资源

打包前，将批准的完整上游 Chromium 发行目录及对应 Xray 资源放在本目录下的 `pigclaude-runtime/`。该目录不提交到仓库，也不会自动下载或选择发行版本。

可执行文件位置如下；浏览器的其余框架、资源和目录结构必须随上游完整保留：

| 平台        | Chromium 可执行文件                                                      | Xray 可执行文件           |
| ----------- | ------------------------------------------------------------------------ | ------------------------- |
| macOS arm64 | `chromium/darwin-arm64/fingerprint-chromium.app/Contents/MacOS/Chromium` | `xray/darwin-arm64/xray`  |
| Windows x64 | `chromium/win32-x64/chrome.exe`                                          | `xray/win32-x64/xray.exe` |
| Linux x64   | `chromium/linux-x64/chrome`                                              | `xray/linux-x64/xray`     |

打包前只检查目标平台的两个可执行文件和构建后的守护程序是否存在；这不能代替完整性、架构、签名或安装态验收。应用启动时还会检查二进制格式和架构。当前正式版本和三平台验收仍待完成。
