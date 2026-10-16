# 工程约定

本文件只放长期有效的写法。产品边界、目录和这次要做的功能写在 `docs/superpowers/` 的规格和实现计划里，不写在这里。

不另写 `.cursor/rules` 或 `CLAUDE.md`。

## 注释

- 每个源文件开头有一段中文注释，说明这个文件负责什么。测试文件也要有。
- 每个导出的函数、类型和方法有中文注释，说明它保证什么。
- 不给一眼能看懂的语句逐行加注释。
- 注释使用中文。规格里已经命名的类型和函数继续用原来的英文名字。

## 打包

- 源码里保留注释。发布构建的 JavaScript 产物里不保留注释。
- TypeScript 的 `removeComments` 为 `true`。
- 打包器丢掉全部注释，包括许可证注释。Electron 使用 esbuild 时设置 `legalComments: "none"`。
- Rust 注释不会进入二进制。不要把说明文字写进会打进二进制的字符串。

## 格式

TypeScript 和 TSX 使用 Prettier：

- `printWidth`: 100
- `semi`: false
- `singleQuote`: false
- `trailingComma`: all
- `arrowParens`: always

Rust 使用 rustfmt：`edition = "2024"`，`max_width = 100`。

## Lint

- TypeScript 使用 ESLint 和 typescript-eslint。`any`、`@ts-ignore`、`@ts-expect-error` 是错误。
- `.ts`、`.tsx`、`.rs` 每个文件最多 500 行，测试文件也算。超过就拆文件，不把上限改大。
- 一个文件只放一个主要概念。不建只做转发的 `index.ts`。
- Rust 库代码不用 `unwrap`、`expect`、`panic`。`main.rs` 可以在启动失败时退出。
- 提交前通过 `pnpm --dir frontend exec eslint .`、`pnpm --dir frontend exec prettier --check .`、`cargo fmt --check --manifest-path backend/Cargo.toml` 和 `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings`。
