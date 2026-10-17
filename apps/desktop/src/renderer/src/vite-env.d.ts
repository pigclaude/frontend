// 让 TypeScript 认识 Vite 注入的客户端类型，以及预加载暴露的桌面桥。
/// <reference types="vite/client" />

interface PigclaudeBridge {
  platform: string
  openExternal?: (url: string) => Promise<void>
}

interface Window {
  pigclaude?: PigclaudeBridge
}
