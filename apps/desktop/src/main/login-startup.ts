// 负责各平台的自动启动登记和启动来源识别，开发版不会登记 Electron 自身。

import { isAbsolute } from "node:path"
import type { LoginItemSettings, LoginItemSettingsOptions, Settings } from "electron"
import { createXdgAutostart } from "./xdg-autostart"

const autostartArgument = "--pigclaude-autostart"
const windowsLoginItem = "com.pigclaude.desktop.autostart"

type NativeLoginItems = {
  getLoginItemSettings(options?: LoginItemSettingsOptions): Partial<LoginItemSettings>
  setLoginItemSettings(settings: Settings): void
}

/** 登录启动的系统适配。读取返回实际登记状态，无法登记的运行环境返回 null。 */
export type LoginStartup = {
  /** 读取当前系统设置，外部停用会反映在读取结果上。 */
  enabled(): Promise<boolean | null>
  /** 仅在用户修改设置时登记或移除启动项。 */
  set(enabled: boolean): Promise<boolean>
  /** 根据系统或自启入口传入的参数识别本次启动来源。 */
  openedAutomatically(argv: readonly string[]): boolean
}

/** 区分自启入口和应用的正常双击启动。 */
export function hasAutostartArgument(argv: readonly string[]): boolean {
  return argv.includes(autostartArgument)
}

/** 以打包后的应用路径登记 macOS、Windows 登录项或 Linux XDG 自启入口。 */
export function createLoginStartup(options: {
  platform: NodeJS.Platform
  packaged: boolean
  executable: string
  home: string
  env: NodeJS.ProcessEnv
  native: NativeLoginItems
}): LoginStartup {
  const { platform, packaged, native } = options
  const openedAutomatically = (argv: readonly string[]) =>
    hasAutostartArgument(argv) ||
    (packaged && platform === "darwin" && native.getLoginItemSettings().wasOpenedAtLogin === true)
  if (!packaged) return { enabled: async () => null, set: unavailable, openedAutomatically }

  if (platform === "linux") {
    const image = options.env["APPIMAGE"]
    const executable = image && isAbsolute(image) ? image : options.executable
    return {
      ...createXdgAutostart(
        options.home,
        options.env["XDG_CONFIG_HOME"],
        executable,
        autostartArgument,
      ),
      openedAutomatically,
    }
  }
  if (platform !== "darwin" && platform !== "win32")
    return { enabled: async () => null, set: unavailable, openedAutomatically }

  const parameters =
    platform === "win32"
      ? { path: `"${options.executable}"`, args: [autostartArgument] }
      : undefined
  const enabled = async () => {
    const settings = native.getLoginItemSettings(parameters)
    if (parameters === undefined) return settings.openAtLogin === true
    return (
      settings.launchItems?.some(
        (item) => item.name === windowsLoginItem && item.scope === "user" && item.enabled,
      ) ?? false
    )
  }
  return {
    enabled,
    async set(openAtLogin) {
      native.setLoginItemSettings({
        openAtLogin,
        ...(parameters === undefined ? {} : { ...parameters, name: windowsLoginItem }),
      })
      if ((await enabled()) !== openAtLogin) throw new Error("STARTUP_LOGIN_ITEM_UNCHANGED")
      return openAtLogin
    },
    openedAutomatically,
  }
}

async function unavailable(): Promise<never> {
  throw new Error("STARTUP_LOGIN_ITEM_UNAVAILABLE")
}
