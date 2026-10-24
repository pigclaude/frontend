// 负责生成用户站授权和 Claude 订阅授权共用的品牌化回环完成页。
import type { ServerResponse } from "node:http"

/** 完成页的稳定输入；成功和失败共用同一套布局。 */
export type CompletionPageInput = {
  kind: "success" | "error"
  title: string
  message: string
  hint?: string
}

const brandPath =
  "M340 140C418 140 482 146 552 146C723 146 840 256 840 420C840 586 718 686 550 686H414C370 686 336 714 336 754C336 776 348 790 372 796C412 806 438 827 438 851C438 872 419 884 388 884C266 884 184 789 184 662V304C184 205 243 140 340 140ZM514 276A194 144 0 0 1 708 420A194 144 0 0 1 514 564A194 144 0 0 1 320 420A194 144 0 0 1 514 276Z"
const snoutPath =
  "M514 276A194 144 0 0 1 708 420A194 144 0 0 1 514 564A194 144 0 0 1 320 420A194 144 0 0 1 514 276Z"

const styles = `
:root {
  color-scheme: dark;
  --bg: #08090a;
  --card: #0f1011;
  --fg: #f7f8f8;
  --fg-2: #d0d6e0;
  --muted: #8a8f98;
  --meta: #62666d;
  --border: rgb(255 255 255 / 8%);
  --border-soft: rgb(255 255 255 / 5%);
  --accent: #8b7cf6;
  --tone: #4ade80;
  --tone-rgb: 74 222 128;
}
.error { --tone: #f87171; --tone-rgb: 248 113 113; }
* { box-sizing: border-box; }
html, body { min-height: 100%; }
body {
  position: relative;
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px 20px;
  overflow: hidden;
  background: var(--bg);
  color: var(--fg);
  font-family: "Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI",
    "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
}
body::before,
body::after {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
}
body::before {
  background:
    radial-gradient(60% 45% at 50% -8%, rgb(139 124 246 / 22%) 0%, transparent 70%),
    radial-gradient(40% 30% at 50% 108%, rgb(99 82 217 / 10%) 0%, transparent 70%);
}
body::after {
  background-image:
    linear-gradient(rgb(255 255 255 / 3%) 1px, transparent 1px),
    linear-gradient(90deg, rgb(255 255 255 / 3%) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(55% 50% at 50% 40%, #000 0%, transparent 100%);
}
.stage {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  width: min(420px, 100%);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--fg);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.brand svg { width: 26px; height: 26px; }
.card {
  position: relative;
  width: 100%;
  padding: 40px 32px 28px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: linear-gradient(180deg, rgb(255 255 255 / 3.5%), rgb(255 255 255 / 1%)), var(--card);
  box-shadow:
    0 1px 0 rgb(255 255 255 / 6%) inset,
    0 30px 80px -40px rgb(0 0 0 / 80%);
  text-align: center;
}
.card::before {
  content: "";
  position: absolute;
  top: -1px;
  left: 20%;
  right: 20%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgb(var(--tone-rgb) / 60%), transparent);
}
.status {
  position: relative;
  display: grid;
  width: 64px;
  height: 64px;
  margin: 0 auto 22px;
  place-items: center;
  border-radius: 50%;
  background: rgb(var(--tone-rgb) / 12%);
  color: var(--tone);
  box-shadow:
    0 0 0 1px rgb(var(--tone-rgb) / 28%) inset,
    0 0 0 8px rgb(var(--tone-rgb) / 5%),
    0 0 40px -6px rgb(var(--tone-rgb) / 45%);
  animation: pop 420ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
}
.status svg { width: 30px; height: 30px; }
.status path {
  stroke-dasharray: 30;
  stroke-dashoffset: 30;
  animation: draw 360ms 220ms ease-out forwards;
}
h1 {
  margin: 0;
  font-size: 22px;
  line-height: 1.3;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.message {
  margin: 10px auto 0;
  max-width: 330px;
  text-wrap: balance;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.7;
}
.hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 28px 0 0;
  padding-top: 18px;
  border-top: 1px solid var(--border-soft);
  color: var(--meta);
  font-size: 12px;
  line-height: 1.6;
}
.hint::before {
  content: "";
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--tone);
  box-shadow: 0 0 8px rgb(var(--tone-rgb) / 70%);
}
.footnote {
  margin: 0;
  color: var(--meta);
  font-size: 12px;
}
@keyframes pop {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes draw {
  to { stroke-dashoffset: 0; }
}
@media (max-width: 420px) {
  .card { padding: 32px 22px 24px; border-radius: 18px; }
  h1 { font-size: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`

const successIcon = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m5 12.5 4.2 4.2L19 7" />
</svg>`

const errorIcon = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
  stroke-linecap="round" aria-hidden="true">
  <path d="M7 7l10 10M17 7 7 17" />
</svg>`

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character)
}

/** 生成自包含的完成页；不加载外部资源，也不回显回调参数。 */
export function renderCompletionPage(input: CompletionPageInput): string {
  const icon = input.kind === "success" ? successIcon : errorIcon
  const hint = input.hint ? `<p class="hint">${escapeHtml(input.hint)}</p>` : ""
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'" />
  <title>${escapeHtml(input.title)} · PigClaude</title>
  <style>${styles}</style>
</head>
<body class="${input.kind}">
  <div class="stage">
    <div class="brand">
      <svg viewBox="0 0 1024 1024" fill="none" aria-hidden="true" focusable="false">
        <path fill="currentColor" fill-rule="evenodd" d="${brandPath}" />
        <path fill="#E0607E" d="${snoutPath}" />
        <ellipse cx="426" cy="420" rx="52" ry="62" fill="currentColor" />
        <ellipse cx="602" cy="420" rx="52" ry="62" fill="currentColor" />
      </svg>
      <span>PigClaude</span>
    </div>
    <main class="card">
      <div class="status ${input.kind}" aria-hidden="true">${icon}</div>
      <h1>${escapeHtml(input.title)}</h1>
      <p class="message">${escapeHtml(input.message)}</p>
      ${hint}
    </main>
    <p class="footnote">此页面由本机 PigClaude 提供</p>
  </div>
</body>
</html>`
}

/** 以禁止缓存和脚本的响应头输出完成页。 */
export function sendCompletionPage(
  response: ServerResponse,
  input: CompletionPageInput,
  status = 200,
): void {
  response.statusCode = status
  response.setHeader("content-type", "text/html; charset=utf-8")
  response.setHeader("cache-control", "no-store")
  response.setHeader("x-content-type-options", "nosniff")
  response.setHeader("referrer-policy", "no-referrer")
  response.setHeader(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
  )
  response.end(renderCompletionPage(input))
}
