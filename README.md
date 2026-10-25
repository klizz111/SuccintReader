# SuccintReader

基于 **Tauri 2 + React 18 + TypeScript** 的跨端 txt 小说阅读器，一套代码支持 **macOS / Windows / iOS**。

## 功能

- **txt 阅读引擎**
  - 大文件流式按偏移读取（章节只加载当前一章，10MB/100MB 级文件无压力）
  - 编码自动探测：UTF-8 / UTF-8 BOM / UTF-16（自动转码存储）/ GBK
  - 进度滑条：拖动映射全书字节偏移，任意跳转
  - 手势：**左右滑动** 切换上一章/下一章；**上划微调**前进、下划微调后退（桌面端 ←→↑↓ 键等价）
  - 章节/分卷自动划分（第N章/N回/Chapter N/第N卷 等多正则族）
  - 无分卷的书可**自定义分卷**（如 `1-100 第一卷; 101-200 第二卷`）实现目录折叠
  - **AI 章节适配**：配置任意 HTTP 端点，由 AI 自动划分章节（协议见下文）
  - 书签：章节 + 位置 + 摘录 + 备注
- **阅读界面自定义**：字号、行间距、左右/上下边距、背景色、文字颜色、衬线字体，预设主题（纸墨/护眼/夜间/纯白/羊皮），全局默认 + 单书覆盖
- **书架**：封面自定义、标签、按书名/作者/标签搜索、文件夹归档
- **跨端同步**：一键导出整库备份（txt + 封面 + SQLite 全量数据打成单个 `.tar.gz`），在其他设备导入即恢复；按文件 hash 去重，进度冲突取较新者
- **深色模式**：主界面支持浅色/深色/自动三档，自动档实时跟随系统外观（macOS / Windows / iOS 均生效），阅读页主题不受影响

## 开发

```bash
pnpm install

# 桌面端开发（macOS / Windows）
pnpm tauri dev

# 单元测试（解析引擎）
cd src-tauri && cargo test

# macOS 打包
pnpm tauri build
```

### iOS 构建（需要 macOS + Xcode + CocoaPods）

```bash
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim
pnpm tauri ios init
pnpm tauri ios dev        # 模拟器调试
pnpm tauri ios build      # 真机/ipa 构建（需在 Apple 开发者账号配置签名）
```

### Windows 打包

在 Windows 机器上执行 `pnpm install && pnpm tauri build` 即可；也可使用仓库中的 GitHub Actions 工作流。

## AI 章节适配协议

应用会向配置的端点 `POST`（默认发送正文前 **10,000 字符**，可在对话框中调整，范围 1,000 ~ 2,000,000）：

```json
{
  "task": "chapter_split",
  "text": "<书的采样文本>",
  "prompt": "<用户在设置页配置的 prompt>"
}
```

期望响应（JSON）：

```json
[{ "title": "第一章 风雪夜归人", "offset": 1234 }, ...]
```

- `offset` 是**字符下标**（不是字节），应用自动换算为 UTF-8 字节偏移
- 按 `offset` 升序；认证使用 `Authorization: Bearer <apiKey>`（可选）
- 解析失败或结果过少时保留原有目录，不会破坏数据

采样范围之外的章节不参与划分，请按需调大采样字符数。

## 数据与备份格式

- 数据目录：`~/Library/Application Support/com.succintreader.app`（macOS），`%APPDATA%/com.succintreader.app`（Windows）
- 备份包为 tar.gz，内含 `manifest.json`（格式版本）、`library.db`、books/、covers/
- 格式版本不匹配时导入会被拒绝

## 项目结构

```
src/            React 前端（pages / components / api.ts / types.ts）
src-tauri/src/  Rust 后端
  book.rs       txt 解析引擎（编码探测、章节/分卷正则、按偏移读取）
  library.rs    书库 CRUD（书籍/章节/分卷/文件夹/标签/书签/设置）
  backup.rs     备份导出/导入（tar.gz + manifest 校验 + 合并去重）
  db.rs         SQLite 建表与迁移
```
