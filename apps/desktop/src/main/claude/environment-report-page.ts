// 生成本机自检报告；仅完整通过的本轮报告包含授权表单，导出始终脱敏。

import type { EnvironmentCheckReport } from "./environment-check-model"
import { environmentReportLifetimeMs } from "./environment-check-model"

const labels = { passed: "通过", failed: "失败", unknown: "未能确认", info: "说明" }

/** 显示采样中的本机页面，不携带授权地址或参数。 */
export function environmentProgressPage(): string {
  return documentHtml(
    "<main><h1>授权环境自检</h1><p>正在读取本次 PigBrowser 配置与网络证据，请保持窗口打开。</p><p>检测完成后，所有必需项通过才会提供继续授权按钮。</p></main>",
  )
}

/** 为本轮生成可见证据和脱敏下载；失败与未完成分支不嵌入 OAuth 信息。 */
export function environmentReportPage(
  report: EnvironmentCheckReport,
  authorizeUrl: string,
): string {
  const title = { passed: "自检通过", blocked: "自检未通过", incomplete: "自检尚未完成" }[
    report.verdict
  ]
  const rows = report.checks
    .map(
      (check) =>
        `<article class="${check.state}"><h2>${escape(check.title)} <span>${labels[check.state]}${check.critical ? " · 必需" : ""}</span></h2><dl><dt>期望</dt><dd>${escape(check.expected)}</dd><dt>实际</dt><dd>${escape(check.actual)}</dd><dt>证据</dt><dd>${escape(check.evidence)}</dd><dt>处理</dt><dd>${escape(check.remedy)}</dd></dl></article>`,
    )
    .join("")
  const exported = {
    policy: report.policy,
    runId: report.runId,
    createdAt: new Date(report.createdAt).toISOString(),
    networkMode: report.networkMode,
    verdict: report.verdict,
    checks: report.checks.map((check) =>
      Object.fromEntries(
        Object.entries(check).map(([key, value]) => [
          key,
          typeof value === "string" ? redact(value) : value,
        ]),
      ),
    ),
    redaction: "已隐去完整 IPv4；不导出配置摘要、凭据、代理地址、私有路径或 OAuth 信息",
  }
  const script = `const report=${JSON.stringify(exported).replaceAll("<", "\\u003c")};document.getElementById("export").onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="pigclaude-environment-"+report.runId+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};const form=document.querySelector("form");if(form)setTimeout(()=>{form.replaceWith(Object.assign(document.createElement("p"),{textContent:"本轮报告已过期，请返回 PigClaude 取消后重新检测。"}))},${Math.max(0, report.createdAt + environmentReportLifetimeMs - Date.now())});`
  return documentHtml(
    `<main data-verdict="${report.verdict}"><h1>${title}</h1><p>${escape(report.policy)} · ${report.networkMode === "bound" ? "绑定代理" : "系统网络"} · ${escape(new Date(report.createdAt).toLocaleString("zh-CN"))}</p><p>报告只覆盖本次浏览器配置与所列网络采样，不预测账号封禁概率。</p>${report.verdict === "passed" ? authorizationForm(authorizeUrl) : '<p class="notice">必需项失败或缺少证据，暂不提供授权入口。请返回 PigClaude 取消本次操作，处理后重新检测。</p>'}<button id="export" type="button">导出脱敏 JSON</button>${rows}</main><script>${script}</script>`,
  )
}

function authorizationForm(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("授权入口无效")
  const inputs = [...url.searchParams]
    .map(([name, item]) => `<input type="hidden" name="${escape(name)}" value="${escape(item)}">`)
    .join("")
  url.search = ""
  return `<form method="get" action="${escape(url.href)}">${inputs}<p>检测已通过，接下来由你登录 Claude 并完成授权。</p><button type="submit">继续 Claude 授权</button></form>`
}

function documentHtml(body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action https:; base-uri 'none'"><title>PigClaude 授权环境自检</title><style>body{background:#f5f5f3;color:#242526;font:15px/1.65 system-ui,sans-serif;margin:0}main{max-width:960px;margin:32px auto;padding:28px}h1{font-size:28px}h2{font-size:18px;margin:0 0 12px}article{background:#fff;border:1px solid #ddd;border-left:4px solid #888;border-radius:8px;padding:20px;margin:16px 0}.passed{border-left-color:#29824b}.failed{border-left-color:#bc3434}.unknown{border-left-color:#b58016}span{font-size:13px;font-weight:400}dl{display:grid;grid-template-columns:44px 1fr;gap:8px 16px;margin:0}dt{color:#696c70}dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}button{border:1px solid #bbb;background:#fff;border-radius:6px;padding:10px 18px;cursor:pointer;margin:8px 8px 8px 0}form button{background:#234d39;color:white}.notice{background:#fff2da;padding:16px;border-radius:6px}</style></head><body>${body}</body></html>`
}

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? "",
  )
}
function redact(value: string): string {
  return value.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[IPv4 已隐去]")
}
