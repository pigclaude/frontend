// 负责主界面的内容安全策略：构建时写进 index.html，开发服务器和视觉套件不带它。

/**
 * 主界面的 Content-Security-Policy。脚本只能是安装包里的文件，不允许 eval、内联脚本和远程代码；
 * 页面只能向应用自身发请求，也不嵌入框架。style-src 留 'unsafe-inline'：编辑器在运行时插入样式表。
 * img-src 放开 http(s)：聊天 Markdown 的远程图片和内置浏览器的网站图标要直接显示。
 */
export function rendererContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: http: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ")
}
