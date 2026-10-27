// 负责可自定义指纹字段的常用选项；空值仍由控件表示自动或跟随默认，不改变存储语义。

import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import type { FingerprintEditableFieldKey, FingerprintFieldOption } from "./fingerprint-fields"

/** 同时支持常用选项与自定义值的字段，供控件和覆盖检查共用。 */
export const fingerprintChoiceKeys = [
  "seed",
  "brandVersion",
  "platformVersion",
  "lang",
  "acceptLang",
  "timezone",
  "hardwareConcurrency",
] as const

/** 可从常用取值选择、也可自由填写的指纹字段。 */
export type FingerprintChoiceFieldKey = (typeof fingerprintChoiceKeys)[number]

const languages: FingerprintFieldOption[] = [
  { value: "zh-CN", label: "简体中文（zh-CN）" },
  { value: "zh-TW", label: "繁體中文（zh-TW）" },
  { value: "en-US", label: "英语 · 美国（en-US）" },
  { value: "en-GB", label: "英语 · 英国（en-GB）" },
  { value: "en-SG", label: "英语 · 新加坡（en-SG）" },
  { value: "ja-JP", label: "日本語（ja-JP）" },
  { value: "ko-KR", label: "한국어（ko-KR）" },
  { value: "de-DE", label: "Deutsch（de-DE）" },
  { value: "fr-FR", label: "Français（fr-FR）" },
  { value: "es-ES", label: "Español（es-ES）" },
  { value: "pt-BR", label: "Português（pt-BR）" },
  { value: "it-IT", label: "Italiano（it-IT）" },
  { value: "ru-RU", label: "Русский（ru-RU）" },
  { value: "vi-VN", label: "Tiếng Việt（vi-VN）" },
  { value: "th-TH", label: "ภาษาไทย（th-TH）" },
  { value: "id-ID", label: "Bahasa Indonesia（id-ID）" },
  { value: "hi-IN", label: "हिन्दी（hi-IN）" },
  { value: "ar-SA", label: "العربية（ar-SA）" },
]

const languageKeywords: Record<string, string[]> = {
  "zh-CN": ["中文", "汉语", "中国", "简体", "chinese", "china"],
  "zh-TW": ["中文", "台湾", "台灣", "繁体", "繁體", "chinese", "taiwan"],
  "en-US": ["英文", "英语", "美国", "美式", "english", "usa"],
  "en-GB": ["英文", "英语", "英国", "英式", "english", "uk"],
  "en-SG": ["英文", "英语", "新加坡", "english", "singapore"],
  "ja-JP": ["日语", "日本", "japanese", "japan"],
  "ko-KR": ["韩语", "韩国", "korean", "korea"],
  "de-DE": ["德语", "德国", "german", "germany"],
  "fr-FR": ["法语", "法国", "french", "france"],
  "es-ES": ["西班牙语", "西语", "西班牙", "spanish", "spain"],
  "pt-BR": ["葡萄牙语", "葡语", "巴西", "portuguese", "brazil"],
  "it-IT": ["意大利语", "意大利", "italian", "italy"],
  "ru-RU": ["俄语", "俄罗斯", "russian", "russia"],
  "vi-VN": ["越南语", "越南", "vietnamese", "vietnam"],
  "th-TH": ["泰语", "泰国", "thai", "thailand"],
  "id-ID": ["印尼语", "印尼", "印度尼西亚", "indonesian", "indonesia"],
  "hi-IN": ["印地语", "印度", "hindi", "india"],
  "ar-SA": ["阿拉伯语", "阿语", "沙特", "arabic"],
}

const timezones: FingerprintFieldOption[] = [
  { value: "system", label: "系统时区（显式指定）" },
  { value: "UTC", label: "协调世界时（UTC）" },
  { value: "Asia/Shanghai", label: "上海（Asia/Shanghai）" },
  { value: "Asia/Hong_Kong", label: "香港（Asia/Hong_Kong）" },
  { value: "Asia/Taipei", label: "台北（Asia/Taipei）" },
  { value: "Asia/Tokyo", label: "东京（Asia/Tokyo）" },
  { value: "Asia/Seoul", label: "首尔（Asia/Seoul）" },
  { value: "Asia/Singapore", label: "新加坡（Asia/Singapore）" },
  { value: "Asia/Bangkok", label: "曼谷（Asia/Bangkok）" },
  { value: "Asia/Kolkata", label: "加尔各答（Asia/Kolkata）" },
  { value: "Asia/Dubai", label: "迪拜（Asia/Dubai）" },
  { value: "America/Los_Angeles", label: "洛杉矶（America/Los_Angeles）" },
  { value: "America/New_York", label: "纽约（America/New_York）" },
  { value: "America/Chicago", label: "芝加哥（America/Chicago）" },
  { value: "America/Denver", label: "丹佛（America/Denver）" },
  { value: "America/Toronto", label: "多伦多（America/Toronto）" },
  { value: "America/Sao_Paulo", label: "圣保罗（America/Sao_Paulo）" },
  { value: "Europe/London", label: "伦敦（Europe/London）" },
  { value: "Europe/Berlin", label: "柏林（Europe/Berlin）" },
  { value: "Europe/Paris", label: "巴黎（Europe/Paris）" },
  { value: "Europe/Moscow", label: "莫斯科（Europe/Moscow）" },
  { value: "Australia/Sydney", label: "悉尼（Australia/Sydney）" },
  { value: "Pacific/Auckland", label: "奥克兰（Pacific/Auckland）" },
]

const platformVersions = new Map([
  ["macos", ["15.2.0", "15.0.0", "14.0.0", "13.0.0", "12.0.0"]],
  ["windows", ["10.0.0"]],
  ["linux", ["6.8.0", "6.6.0", "6.1.0", "5.15.0"]],
])

/** 判断字段是否使用带自定义入口的选项控件。 */
export function isFingerprintChoiceField(
  key: FingerprintEditableFieldKey,
): key is FingerprintChoiceFieldKey {
  return fingerprintChoiceKeys.some((item) => item === key)
}

/** 返回字段的常用选项；系统版本随操作系统变化，已有自定义值由控件原样保留。 */
export function fingerprintChoices(
  key: FingerprintChoiceFieldKey,
  value: ClaudeFingerprintView,
): FingerprintFieldOption[] {
  switch (key) {
    case "seed":
      return []
    case "brandVersion":
      return ["148.0.7778.215", "148", "147", "146", "145", "144"].map((version) => ({
        value: version,
        label: version,
      }))
    case "platformVersion":
      return (platformVersions.get(value.platform) ?? [...platformVersions.values()].flat()).map(
        (version) => ({ value: version, label: version }),
      )
    case "lang":
      return languages.map((language) => ({
        ...language,
        keywords: languageKeywords[language.value],
      }))
    case "acceptLang":
      return [
        ...languages.map((language) => ({
          value: `${language.value},${language.value.split("-")[0]}`,
          label: `${language.label}优先`,
          keywords: languageKeywords[language.value],
        })),
        { value: "zh-CN,zh,en-US,en", label: "简体中文优先，英语备用" },
        { value: "zh-TW,zh,en-US,en", label: "繁體中文优先，英语备用" },
        { value: "en-US,en,zh-CN,zh", label: "英语优先，简体中文备用" },
      ]
    case "timezone":
      return timezones
    case "hardwareConcurrency":
      return [1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 96, 128].map((cores) => ({
        value: String(cores),
        label: `${cores} 核`,
      }))
  }
}

/** 仅在用户主动选择生成时创建一个有效种子；草稿保存后不再自动改变。 */
export function generateFingerprintSeed(): string {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  return String((random % 2_147_483_647) + 1)
}
