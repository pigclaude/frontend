// 为用户主动选择的 CheckCC 检测生成本地引导页，保留同一浏览器与授权参数。

/** 未选择检测时返回原授权地址；选择时先等待用户在本次浏览器中确认检测结果。 */
export function authorizationStartUrl(authorizationUrl: string, preflight?: "checkcc"): string {
  if (preflight !== "checkcc") return authorizationUrl
  const url = new URL(authorizationUrl)
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("授权地址无效")
  }
  const inputs = [...url.searchParams]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join("")
  const action = escapeHtml(`${url.origin}${url.pathname}`)
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>浏览器环境检测</title><style>body{font:16px -apple-system,BlinkMacSystemFont,sans-serif;max-width:640px;margin:12vh auto;padding:0 24px;line-height:1.7;color:#202124}a,button{display:inline-block;padding:10px 16px;border-radius:8px}a{background:#222;color:white;text-decoration:none}form{margin-top:32px;padding-top:24px;border-top:1px solid #ddd}label{display:block;margin-bottom:16px}button{font:inherit;cursor:pointer}</style></head><body><h1>先检测浏览器环境</h1><p>请在当前浏览器中打开 CheckCC 并完成检测。查看结果后回到此页，再决定是否继续 Claude 授权。</p><a href="https://checkcc.org/" target="_blank" rel="noopener noreferrer">打开 CheckCC 检测</a><form method="get" action="${action}">${inputs}<label><input type="checkbox" required> 我已完成检测并确认结果通过</label><button type="submit">继续 Claude 授权</button></form></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}
