// 负责可自定义指纹字段的常用选项；空值仍由控件表示自动或跟随默认，不改变存储语义。

import { desktopText } from "../locale/text"
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
  { value: "zh-CN", label: desktopText("fingerprintExtra.fingerprint-choices.1") },
  { value: "zh-TW", label: desktopText("fingerprintExtra.fingerprint-choices.2") },
  { value: "en-US", label: desktopText("fingerprintExtra.fingerprint-choices.3") },
  { value: "en-GB", label: desktopText("fingerprintExtra.fingerprint-choices.4") },
  { value: "en-SG", label: desktopText("fingerprintExtra.fingerprint-choices.5") },
  { value: "ja-JP", label: desktopText("fingerprintExtra.fingerprint-choices.6") },
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
  "zh-CN": [
    desktopText("fingerprintExtra.fingerprint-choices.7"),
    desktopText("fingerprintExtra.fingerprint-choices.8"),
    desktopText("fingerprintExtra.fingerprint-choices.9"),
    desktopText("fingerprintExtra.fingerprint-choices.10"),
    "chinese",
    "china",
  ],
  "zh-TW": [
    desktopText("fingerprintExtra.fingerprint-choices.11"),
    desktopText("fingerprintExtra.fingerprint-choices.12"),
    desktopText("fingerprintExtra.fingerprint-choices.13"),
    desktopText("fingerprintExtra.fingerprint-choices.14"),
    desktopText("fingerprintExtra.fingerprint-choices.15"),
    "chinese",
    "taiwan",
  ],
  "en-US": [
    desktopText("fingerprintExtra.fingerprint-choices.16"),
    desktopText("fingerprintExtra.fingerprint-choices.17"),
    desktopText("fingerprintExtra.fingerprint-choices.18"),
    desktopText("fingerprintExtra.fingerprint-choices.19"),
    "english",
    "usa",
  ],
  "en-GB": [
    desktopText("fingerprintExtra.fingerprint-choices.20"),
    desktopText("fingerprintExtra.fingerprint-choices.21"),
    desktopText("fingerprintExtra.fingerprint-choices.22"),
    desktopText("fingerprintExtra.fingerprint-choices.23"),
    "english",
    "uk",
  ],
  "en-SG": [
    desktopText("fingerprintExtra.fingerprint-choices.24"),
    desktopText("fingerprintExtra.fingerprint-choices.25"),
    desktopText("fingerprintExtra.fingerprint-choices.26"),
    "english",
    "singapore",
  ],
  "ja-JP": [
    desktopText("fingerprintExtra.fingerprint-choices.27"),
    desktopText("fingerprintExtra.fingerprint-choices.28"),
    "japanese",
    "japan",
  ],
  "ko-KR": [
    desktopText("fingerprintExtra.fingerprint-choices.29"),
    desktopText("fingerprintExtra.fingerprint-choices.30"),
    "korean",
    "korea",
  ],
  "de-DE": [
    desktopText("fingerprintExtra.fingerprint-choices.31"),
    desktopText("fingerprintExtra.fingerprint-choices.32"),
    "german",
    "germany",
  ],
  "fr-FR": [
    desktopText("fingerprintExtra.fingerprint-choices.33"),
    desktopText("fingerprintExtra.fingerprint-choices.34"),
    "french",
    "france",
  ],
  "es-ES": [
    desktopText("fingerprintExtra.fingerprint-choices.35"),
    desktopText("fingerprintExtra.fingerprint-choices.36"),
    desktopText("fingerprintExtra.fingerprint-choices.37"),
    "spanish",
    "spain",
  ],
  "pt-BR": [
    desktopText("fingerprintExtra.fingerprint-choices.38"),
    desktopText("fingerprintExtra.fingerprint-choices.39"),
    desktopText("fingerprintExtra.fingerprint-choices.40"),
    "portuguese",
    "brazil",
  ],
  "it-IT": [
    desktopText("fingerprintExtra.fingerprint-choices.41"),
    desktopText("fingerprintExtra.fingerprint-choices.42"),
    "italian",
    "italy",
  ],
  "ru-RU": [
    desktopText("fingerprintExtra.fingerprint-choices.43"),
    desktopText("fingerprintExtra.fingerprint-choices.44"),
    "russian",
    "russia",
  ],
  "vi-VN": [
    desktopText("fingerprintExtra.fingerprint-choices.45"),
    desktopText("fingerprintExtra.fingerprint-choices.46"),
    "vietnamese",
    "vietnam",
  ],
  "th-TH": [
    desktopText("fingerprintExtra.fingerprint-choices.47"),
    desktopText("fingerprintExtra.fingerprint-choices.48"),
    "thai",
    "thailand",
  ],
  "id-ID": [
    desktopText("fingerprintExtra.fingerprint-choices.49"),
    desktopText("fingerprintExtra.fingerprint-choices.50"),
    desktopText("fingerprintExtra.fingerprint-choices.51"),
    "indonesian",
    "indonesia",
  ],
  "hi-IN": [
    desktopText("fingerprintExtra.fingerprint-choices.52"),
    desktopText("fingerprintExtra.fingerprint-choices.53"),
    "hindi",
    "india",
  ],
  "ar-SA": [
    desktopText("fingerprintExtra.fingerprint-choices.54"),
    desktopText("fingerprintExtra.fingerprint-choices.55"),
    desktopText("fingerprintExtra.fingerprint-choices.56"),
    "arabic",
  ],
}

const timezones: FingerprintFieldOption[] = [
  { value: "system", label: desktopText("fingerprintExtra.fingerprint-choices.57") },
  { value: "UTC", label: desktopText("fingerprintExtra.fingerprint-choices.58") },
  { value: "Asia/Shanghai", label: desktopText("fingerprintExtra.fingerprint-choices.59") },
  { value: "Asia/Hong_Kong", label: desktopText("fingerprintExtra.fingerprint-choices.60") },
  { value: "Asia/Taipei", label: desktopText("fingerprintExtra.fingerprint-choices.61") },
  { value: "Asia/Tokyo", label: desktopText("fingerprintExtra.fingerprint-choices.62") },
  { value: "Asia/Seoul", label: desktopText("fingerprintExtra.fingerprint-choices.63") },
  { value: "Asia/Singapore", label: desktopText("fingerprintExtra.fingerprint-choices.64") },
  { value: "Asia/Bangkok", label: desktopText("fingerprintExtra.fingerprint-choices.65") },
  { value: "Asia/Kolkata", label: desktopText("fingerprintExtra.fingerprint-choices.66") },
  { value: "Asia/Dubai", label: desktopText("fingerprintExtra.fingerprint-choices.67") },
  { value: "America/Los_Angeles", label: desktopText("fingerprintExtra.fingerprint-choices.68") },
  { value: "America/New_York", label: desktopText("fingerprintExtra.fingerprint-choices.69") },
  { value: "America/Chicago", label: desktopText("fingerprintExtra.fingerprint-choices.70") },
  { value: "America/Denver", label: desktopText("fingerprintExtra.fingerprint-choices.71") },
  { value: "America/Toronto", label: desktopText("fingerprintExtra.fingerprint-choices.72") },
  { value: "America/Sao_Paulo", label: desktopText("fingerprintExtra.fingerprint-choices.73") },
  { value: "Europe/London", label: desktopText("fingerprintExtra.fingerprint-choices.74") },
  { value: "Europe/Berlin", label: desktopText("fingerprintExtra.fingerprint-choices.75") },
  { value: "Europe/Paris", label: desktopText("fingerprintExtra.fingerprint-choices.76") },
  { value: "Europe/Moscow", label: desktopText("fingerprintExtra.fingerprint-choices.77") },
  { value: "Australia/Sydney", label: desktopText("fingerprintExtra.fingerprint-choices.78") },
  { value: "Pacific/Auckland", label: desktopText("fingerprintExtra.fingerprint-choices.79") },
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
          label: desktopText("fingerprintExtra.fingerprint-choices.80", {
            value1: String(language.label),
          }),
          keywords: languageKeywords[language.value],
        })),
        {
          value: "zh-CN,zh,en-US,en",
          label: desktopText("fingerprintExtra.fingerprint-choices.81"),
        },
        {
          value: "zh-TW,zh,en-US,en",
          label: desktopText("fingerprintExtra.fingerprint-choices.82"),
        },
        {
          value: "en-US,en,zh-CN,zh",
          label: desktopText("fingerprintExtra.fingerprint-choices.83"),
        },
      ]
    case "timezone":
      return timezones
    case "hardwareConcurrency":
      return [1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 96, 128].map((cores) => ({
        value: String(cores),
        label: desktopText("fingerprintExtra.fingerprint-choices.84", { value1: String(cores) }),
      }))
  }
}

/** 仅在用户主动选择生成时创建一个有效种子；草稿保存后不再自动改变。 */
export function generateFingerprintSeed(): string {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  return String((random % 2_147_483_647) + 1)
}
