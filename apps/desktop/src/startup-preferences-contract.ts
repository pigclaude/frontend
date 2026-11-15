// 定义主进程与通用设置页交换的启动偏好，不包含应用或本机文件路径。

/** 通用设置可以修改的两个启动偏好。 */
export type StartupPreference = "openAtLogin" | "showInDock"

/** 返回可修改的实际设置。当前系统不提供的设置为 null。 */
export type StartupPreferencesView = Record<StartupPreference, boolean | null>

/** 读取启动偏好，由主进程校验并保存单个修改。 */
export type StartupPreferencesBridge = {
  get(): Promise<StartupPreferencesView>
  set(preference: StartupPreference, value: boolean): Promise<boolean>
}
