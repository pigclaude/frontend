// 负责为 home 子项目复用 frontend ESLint 规则并忽略 Next 生成文件。
import { globalIgnores } from "eslint/config"
import baseConfig from "../../eslint.config.mjs"

export default [...baseConfig, globalIgnores([".next/**", "next-env.d.ts"])]
