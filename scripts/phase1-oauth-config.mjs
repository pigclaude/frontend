// 校验本地启动器的固定网站origin和reset namespace，并隔离网站子进程环境。
import { lstat, readFile } from "node:fs/promises"

/** 只读取受限OAuth与reset清单，缺项或与实际运行namespace不符即拒绝启动。 */
export async function localOAuthSites(env) {
  const readPrivate = async (file) => {
    if (!file) throw new Error("LOCAL_OAUTH_CONFIG_REQUIRED")
    const stat = await lstat(file)
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.size > 65536)
      throw new Error("LOCAL_OAUTH_CONFIG_INVALID")
    return JSON.parse(await readFile(file, "utf8"))
  }
  const config = await readPrivate(env.PIGCLAUDE_OAUTH_CONFIG_FILE)
  const manifest = await readPrivate(env.PIGCLAUDE_RESET_MANIFEST_FILE)
  const home = new URL(config.home_origin)
  const admin = new URL(config.admin_origin)
  if (
    config.issuer !== home.origin ||
    config.home_origin !== home.origin ||
    config.admin_origin !== admin.origin ||
    home.protocol !== "http:" ||
    admin.protocol !== "http:" ||
    home.hostname !== "127.0.0.1" ||
    admin.hostname !== "127.0.0.1" ||
    !home.port ||
    !admin.port ||
    home.origin === admin.origin ||
    manifest.project !== "pigclaude" ||
    manifest.dedicated !== true ||
    !/^pigclaude:reset:[a-f0-9]{32}$/.test(manifest.ownership) ||
    manifest.redisNamespace !== manifest.ownership + ":" ||
    env.PIGCLAUDE_AUTH_REDIS_NAMESPACE !== manifest.ownership
  )
    throw new Error("LOCAL_OAUTH_CONFIG_INVALID")
  return { home: home.origin, admin: admin.origin, homePort: +home.port, adminPort: +admin.port }
}

/** 网站仅继承运行所需公开值，数据库、Auth/client/provider/Turnstile秘密和文件引用不传入。 */
export function localWebEnvironment(env, api, home) {
  return Object.fromEntries(
    Object.entries({
      PATH: env.PATH,
      HOME: env.HOME,
      TMPDIR: env.TMPDIR,
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      API_PROXY_TARGET: api,
      PIGCLAUDE_HOME_URL: home,
    }).filter(([, value]) => typeof value === "string"),
  )
}
