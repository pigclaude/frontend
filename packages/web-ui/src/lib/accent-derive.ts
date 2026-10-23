// 负责将自定义品牌色派生为深浅主题的可读强调色。
import { accentEngine } from "@pigclaude/web-ui/lib/accent-engine"

/** 保留品牌色光晕，同时保证按钮和强调文字满足 AA。 */
export const deriveAccent = accentEngine.deriveAccent
