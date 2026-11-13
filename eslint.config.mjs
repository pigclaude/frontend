// 负责前端的 ESLint 规则：检查 TypeScript 文件的 any、ts 注释、行数上限和禁用依赖。
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: [
      "**/release/**",
      "**/dist/**",
      "**/out/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/next-env.d.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": true,
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
        },
      ],
      "max-lines": ["error", { max: 500, skipBlankLines: false, skipComments: false }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@radix-ui/*"],
              message: "基础控件只用 Base UI；Radix 已在 #37 的界面迁移中移除。",
            },
          ],
        },
      ],
    },
  },
)
