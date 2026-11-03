# 上游指纹 Chromium 验收探针

这里保留不依赖自编内核的页面、Worker、UA、音频、Canvas、WebGL、ClientRects 和离线启动探针，以及本机合成代理夹具。探针消费调用方已建立的页面或 CDP 会话，不自行启动浏览器、下载内核或读取现有 profile。

在前端仓运行 `pnpm test:browser-probes` 可执行合成回归；这些测试也由 `pnpm test` 调用。合成测试不代表目标浏览器或三平台通过，真实验收需逐项记录所用上游版本、平台和架构。

音频等检查没有独立精确期望时只验证一致性。调用方负责超时后的页面、会话和进程回收。

当前方案与已有原生运行证据见 [Chromium 与 Xray 接续记录](../../../docs/verification/2026-11-03-browser-xray-transition.md)。
