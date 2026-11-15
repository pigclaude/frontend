// Vite 把受信页面与 Worker 脚本作为文本资源打进主进程，运行时只由插件协议交付。
declare module "*.mjs?raw" {
  const source: string
  export default source
}
