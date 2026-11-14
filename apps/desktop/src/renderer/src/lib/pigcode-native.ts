// 负责把 PigClaude 的桌面桥接成拷入的 Pigcode 组件读取的 window.pigcodeNative：
// 平台、主题来源、窗口按钮、全屏、标题栏菜单与配色、侧栏透明、选文件夹，
// 以及在文件管理器或本机应用里打开项目都走 pigclaude:* 通道。
// 没有桌面桥（浏览器预览、视觉回归）时不安装，Pigcode 组件按浏览器环境处理。

type PigcodeNative = NonNullable<Window["pigcodeNative"]>
type MenuItems = Parameters<NonNullable<PigcodeNative["popupMenu"]>>[0]

/** 由桌面桥生成 Pigcode 外壳要的原生能力；Workbench 的预览窗口 PigClaude 没有，调用时拒绝。 */
export function pigcodeNativeFrom(bridge: PigclaudeBridge): PigcodeNative {
  const native = bridge.window
  const workspaces = bridge.workspaces
  return {
    platform: bridge.platform,
    ...(bridge.systemVersion ? { systemVersion: bridge.systemVersion } : {}),
    setThemeSource: (source) => bridge.setTheme?.(source) ?? Promise.resolve(),
    windowControl: (action) => native?.control(action) ?? Promise.resolve(),
    isMaximized: () => native?.isMaximized() ?? Promise.resolve(false),
    ...(native
      ? {
          isFullScreen: () => native.isFullScreen(),
          onFullScreenChange: (listener: (fullScreen: boolean) => void) =>
            native.onFullScreenChange(listener),
          setTitleBarColors: (colors: { color: string; symbolColor: string }) =>
            native.setTitleBarColors(colors),
          setWindowTranslucent: (translucent: boolean) => native.setTranslucent(translucent),
          popupMenu: (items: MenuItems, position: { x: number; y: number }) =>
            native.popupMenu(items, position),
        }
      : {}),
    ...(workspaces
      ? {
          listOpenApps: async () =>
            (await workspaces.apps()).map((app) => ({ ...app, icon: null })),
          openWithApp: (appId: string, path: string) => workspaces.openWith(path, appId),
          openFolder: (path: string) => workspaces.reveal(path),
        }
      : {}),
    ...(bridge.pickFolder
      ? {
          pickFolder: (labels?: { title?: string; buttonLabel?: string }) =>
            bridge.pickFolder?.(labels) ?? Promise.resolve(null),
        }
      : {}),
    previewOpen: () => Promise.reject(new Error("PREVIEW_UNAVAILABLE")),
    previewClose: () => undefined,
  }
}

/** 有桌面桥时安装 window.pigcodeNative；返回是否安装。 */
export function installPigcodeNative(target: Window = window): boolean {
  const bridge = target.pigclaude
  if (!bridge) return false
  target.pigcodeNative = pigcodeNativeFrom(bridge)
  return true
}
