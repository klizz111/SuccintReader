import { open, save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { AiConfig, ReaderSettings } from "../types";
import { DEFAULT_SETTINGS, DEFAULT_AI_PROMPT } from "../types";
import { getStoredTheme, setTheme, type UiTheme } from "../theme";

interface Props {
  onBack: () => void;
}

export default function SettingsPage({ onBack }: Props) {
  const [global, setGlobal] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [ai, setAi] = useState<AiConfig>({ endpoint: "", apiKey: "", prompt: DEFAULT_AI_PROMPT });
  const [msg, setMsg] = useState("");
  const [uiTheme, setUiTheme] = useState<UiTheme>(getStoredTheme());

  useEffect(() => {
    api.getSettings<Partial<ReaderSettings>>("global").then((s) =>
      setGlobal({ ...DEFAULT_SETTINGS, ...s })
    );
    api.getSettings<Partial<AiConfig>>("ai").then((s) =>
      setAi({ endpoint: "", apiKey: "", prompt: DEFAULT_AI_PROMPT, ...s })
    );
  }, []);

  const toast = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(""), 2500);
  };

  const saveGlobal = (patch: Partial<ReaderSettings>) => {
    const next = { ...global, ...patch };
    setGlobal(next);
    api.saveSettings("global", patch);
  };

  const doExport = async () => {
    const path = await save({
      defaultPath: `succintreader-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`,
      filters: [{ name: "备份包", extensions: ["gz"] }],
    });
    if (!path) return;
    try {
      await api.exportBackup(path);
      toast("备份已导出");
    } catch (e) {
      toast(`导出失败: ${String(e).slice(0, 60)}`);
    }
  };

  const doImport = async () => {
    const path = await open({
      filters: [{ name: "SuccintReader 备份包", extensions: ["gz", "tar.gz"] }],
    });
    if (typeof path !== "string") return;
    if (!window.confirm("导入备份将合并书本与书签（已存在的书按更新时间较新者保留进度），继续？")) return;
    try {
      const stats = await api.importBackup(path);
      toast(`导入完成：新书 ${stats.books_imported}，已存在 ${stats.skipped}，复制文件 ${stats.files_copied}`);
    } catch (e) {
      toast(`导入失败: ${String(e).slice(0, 80)}`);
    }
  };

  return (
    <div className="settings-page">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack}>←</button>
        <h1>设置</h1>
      </div>

      <div className="settings-group-title">外观</div>
      <div className="settings-group">
        <div className="settings-cell">
          <div>
            <div className="cell-label">界面主题</div>
            <div className="cell-desc">选择「自动」可跟随系统深色/浅色模式</div>
          </div>
          <div className="segmented">
            {(["auto", "light", "dark"] as UiTheme[]).map((m) => (
              <button
                key={m}
                className={`segment ${uiTheme === m ? "on" : ""}`}
                onClick={() => {
                  setUiTheme(m);
                  setTheme(m);
                }}
              >
                {m === "auto" ? "自动" : m === "light" ? "浅色" : "深色"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-group-title">全局默认阅读样式（对新书生效）</div>
      <div className="settings-group">
        <div className="settings-cell">
          <div>
            <div className="cell-label">字号</div>
            <div className="cell-desc">{global.fontSize}px</div>
          </div>
          <input
            type="range" min={12} max={32}
            value={global.fontSize}
            onChange={(e) => saveGlobal({ fontSize: Number(e.target.value) })}
          />
        </div>
        <div className="settings-cell">
          <div>
            <div className="cell-label">行间距</div>
            <div className="cell-desc">{global.lineHeight.toFixed(1)}</div>
          </div>
          <input
            type="range" min={1} max={2.5} step={0.1}
            value={global.lineHeight}
            onChange={(e) => saveGlobal({ lineHeight: Number(e.target.value) })}
          />
        </div>
        <div className="settings-cell">
          <div>
            <div className="cell-label">左右边距</div>
            <div className="cell-desc">{global.paddingX}px</div>
          </div>
          <input
            type="range" min={0} max={60} step={2}
            value={global.paddingX}
            onChange={(e) => saveGlobal({ paddingX: Number(e.target.value) })}
          />
        </div>
        <div className="settings-cell">
          <div>
            <div className="cell-label">上下边距</div>
            <div className="cell-desc">{global.paddingY}px</div>
          </div>
          <input
            type="range" min={0} max={80} step={2}
            value={global.paddingY}
            onChange={(e) => saveGlobal({ paddingY: Number(e.target.value) })}
          />
        </div>
        <div className="settings-cell">
          <div className="cell-label">默认背景色</div>
          <input type="color" value={global.bgColor} onChange={(e) => saveGlobal({ bgColor: e.target.value })} />
        </div>
        <div className="settings-cell">
          <div className="cell-label">默认文字颜色</div>
          <input type="color" value={global.textColor} onChange={(e) => saveGlobal({ textColor: e.target.value })} />
        </div>
      </div>

      <div className="settings-group-title">AI 章节适配（全局默认，可在阅读页目录中修改）</div>
      <div className="settings-group">
        <div className="settings-cell" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div className="cell-label" style={{ marginBottom: 6 }}>API 端点</div>
          <input
            type="text"
            placeholder="https://api.example.com/chapter-split"
            value={ai.endpoint}
            onChange={(e) => setAi({ ...ai, endpoint: e.target.value })}
            onBlur={() => api.saveSettings("ai", { endpoint: ai.endpoint })}
          />
        </div>
        <div className="settings-cell" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div className="cell-label" style={{ marginBottom: 6 }}>API Key</div>
          <input
            type="password"
            value={ai.apiKey}
            onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
            onBlur={() => api.saveSettings("ai", { apiKey: ai.apiKey })}
          />
        </div>
        <div className="settings-cell" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div className="cell-label" style={{ marginBottom: 6 }}>Prompt</div>
          <textarea
            rows={3}
            style={{ border: "1px solid var(--ui-border)", borderRadius: 8, padding: 8, background: "var(--ui-bg)" }}
            value={ai.prompt}
            onChange={(e) => setAi({ ...ai, prompt: e.target.value })}
            onBlur={() => api.saveSettings("ai", { prompt: ai.prompt })}
          />
        </div>
      </div>

      <div className="settings-group-title">跨端同步</div>
      <div className="settings-group">
        <div className="settings-cell" style={{ cursor: "pointer" }} onClick={doExport}>
          <div>
            <div className="cell-label">导出备份包</div>
            <div className="cell-desc">整库打包（含 txt、封面、书签、进度、设置）为单个文件</div>
          </div>
          <span>›</span>
        </div>
        <div className="settings-cell" style={{ cursor: "pointer" }} onClick={doImport}>
          <div>
            <div className="cell-label">导入备份包</div>
            <div className="cell-desc">在其他设备上恢复书库，重复书本自动去重</div>
          </div>
          <span>›</span>
        </div>
      </div>

      <div style={{ textAlign: "center", color: "var(--ui-sub)", fontSize: 12, padding: "16px 0 32px" }}>
        SuccintReader · Tauri 跨端 txt 阅读器
      </div>
      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}
