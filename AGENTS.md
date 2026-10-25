# AGENTS.md

## 项目简介

SuccintReader：基于 Tauri 2 + React 18 + TypeScript 的跨端 txt 小说阅读器，目标平台 macOS / Windows / iOS。包管理用 pnpm，Rust 端用 cargo。

## 常用命令

```bash
pnpm install              # 安装前端依赖
pnpm tauri dev            # 桌面端开发调试
pnpm build                # 前端生产构建（tsc + vite）
pnpm tauri build          # macOS 打包（.app + .dmg）
cd src-tauri && cargo test        # 解析引擎单元测试
pnpm tauri ios init       # 初始化 iOS 工程（仅需一次，已执行过）
pnpm tauri ios dev        # iOS 模拟器调试
pnpm tauri ios build      # iOS 构建（真机需配置签名）
```

## 结构

- `src/` — React 前端。`api.ts`（invoke 封装）、`types.ts`（类型与默认值）、`pages/`（ShelfPage/ReaderPage/SettingsPage）、`components/`（面板与对话框）、`styles.css`（全部样式，CSS 变量主题）。
- `src-tauri/src/` — Rust 后端。`book.rs`（txt 解析：编码探测/章节分卷正则/按偏移读取，含单元测试）、`library.rs`（书库 CRUD 命令）、`backup.rs`（tar.gz 备份导出/导入合并）、`db.rs`（SQLite 建表迁移）。
- `src-tauri/gen/apple/` — 生成的 iOS Xcode 工程（勿手改，由 `tauri ios init` 重新生成）。

## 约定

- 新增 Rust 命令后：在 `src-tauri/src/lib.rs` 的 `generate_handler!` 注册，并在 `src/api.ts` 加封装。
- 数据库表结构变更：追加到 `src-tauri/src/db.rs` 的 `MIGRATIONS`（幂等 CREATE TABLE IF NOT EXISTS），不要修改已存在的建表语句。
- 前端状态简单用 React hooks；跨页面共享数据通过 props 传递（见 `App.tsx` 的 View 路由）。
- UI 文案用中文；样式只写在 `styles.css`，阅读器主题通过 CSS 变量（`--reader-*`）注入；主界面深浅色主题由 `src/theme.ts` 在根元素上设置 `data-theme` 驱动（深色变量在 `:root[data-theme="dark"]` 中定义）。
- 章节偏移一律为**字节偏移**（UTF-8/GBK 原始文件字节）；前端滑条按 `offset/file_size` 映射。

## 注意事项

- `encoding_rs` 不支持编码到 UTF-16（只支持解码），测试构造 UTF-16 数据需手动 `encode_utf16()`。
- 备份格式版本在 `src-tauri/src/backup.rs` 的 `FORMAT_VERSION`，修改格式时递增并处理兼容。
- iOS 的权限声明在 `src-tauri/capabilities/default.json`（windows: ["main"] 对移动端同样生效）。
