# 工程约定

本文件只放长期工程约定和工作流入口。新规格与任务统一使用根仓库 Issues；已有规格继续按领域文档中的有效性规则使用。

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
- 提交前从聚合仓根目录通过 `pnpm --dir frontend exec eslint .`、`pnpm --dir frontend exec prettier --check .`、`cargo fmt --all --check --manifest-path backend/Cargo.toml` 和 `cargo clippy --manifest-path backend/Cargo.toml --workspace --all-targets -- -D warnings`。

## Agent skills

### Issue tracker

需求设计、实施和审查使用 Matt Pocock skills。接单前读取 [任务跟踪](../docs/agents/issue-tracker.md)，任务统一位于 `pigclaude/pigclaude`，命令显式指定仓库。

### Triage labels

创建或分流任务前读取 [标签约定](../docs/agents/triage-labels.md)。

### Domain docs

开始探索业务前读取 [领域文档](../docs/agents/domain.md)，使用聚合仓的一份共享词汇表。技能加载、版本核对和恢复见 [运行环境](../docs/agents/skill-runtime.md)。
