// 把账号语言转换为原生进程所需 locale，保留显式地区，不把脚本标签拼成无效 POSIX 名称。

/** 返回系统格式的 locale；不能表示的脚本或变体明确失败，不静默换语言。 */
export function processLocale(value: string): string {
  const tag = value
    .trim()
    .replace(/\.UTF-?8$/i, "")
    .replaceAll("_", "-")
  const locale = new Intl.Locale(tag)
  if (process.platform === "win32") return locale.baseName
  const base = [locale.language, locale.script, locale.region].filter(Boolean).join("-")
  if (base !== locale.baseName) throw new Error("原生进程不支持该语言变体")
  const region = locale.region ?? locale.maximize().region
  if (!region) throw new Error("原生进程无法确定语言地区")
  const regional = new Intl.Locale(`${locale.language}-${region}`)
  let modifier = ""
  if (locale.script && locale.script !== regional.maximize().script) {
    if (locale.language === "sr" && locale.script === "Latn") modifier = "@latin"
    else throw new Error("原生进程无法保留该语言脚本")
  }
  return `${locale.language}_${region}.UTF-8${modifier}`
}
