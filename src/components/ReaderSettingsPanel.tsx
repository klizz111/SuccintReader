import type { ReaderSettings } from "../types";

interface Props {
  settings: ReaderSettings;
  onChange: (s: ReaderSettings) => void;
  onClose: () => void;
  onOpenAppSettings: () => void;
}

const PRESETS = [
  { name: "纸墨", bg: "#f5f0e6", fg: "#3a3226" },
  { name: "护眼", bg: "#e8f0e4", fg: "#2f3d2a" },
  { name: "夜间", bg: "#121418", fg: "#9aa0a6" },
  { name: "纯白", bg: "#ffffff", fg: "#1c1c1e" },
  { name: "羊皮", bg: "#f3e5c8", fg: "#4a3b22" },
];

export default function ReaderSettingsPanel({ settings, onChange, onClose, onOpenAppSettings }: Props) {
  const set = <K extends keyof ReaderSettings>(k: K, v: ReaderSettings[K]) =>
    onChange({ ...settings, [k]: v });

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-header">
          <span>阅读设置</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="sheet-body">
          <div className="settings-row">
            <label>字号</label>
            <input
              type="range" min={12} max={32} step={1}
              value={settings.fontSize}
              onChange={(e) => set("fontSize", Number(e.target.value))}
            />
            <span className="val">{settings.fontSize}px</span>
          </div>
          <div className="settings-row">
            <label>行间距</label>
            <input
              type="range" min={1} max={2.5} step={0.1}
              value={settings.lineHeight}
              onChange={(e) => set("lineHeight", Number(e.target.value))}
            />
            <span className="val">{settings.lineHeight.toFixed(1)}</span>
          </div>
          <div className="settings-row">
            <label>左右边距</label>
            <input
              type="range" min={0} max={60} step={2}
              value={settings.paddingX}
              onChange={(e) => set("paddingX", Number(e.target.value))}
            />
            <span className="val">{settings.paddingX}px</span>
          </div>
          <div className="settings-row">
            <label>上下边距</label>
            <input
              type="range" min={0} max={80} step={2}
              value={settings.paddingY}
              onChange={(e) => set("paddingY", Number(e.target.value))}
            />
            <span className="val">{settings.paddingY}px</span>
          </div>

          <div className="toc-volume">主题预设</div>
          <div className="theme-swatches">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                className={`swatch ${settings.bgColor === p.bg ? "on" : ""}`}
                style={{ background: `linear-gradient(135deg, ${p.bg} 60%, ${p.fg} 60%)` }}
                title={p.name}
                onClick={() => onChange({ ...settings, bgColor: p.bg, textColor: p.fg })}
              />
            ))}
          </div>

          <div className="settings-row">
            <label>背景色</label>
            <div className="color-field">
              <input
                type="color"
                value={settings.bgColor}
                onChange={(e) => set("bgColor", e.target.value)}
              />
              <span className="val">{settings.bgColor}</span>
            </div>
          </div>
          <div className="settings-row">
            <label>文字颜色</label>
            <div className="color-field">
              <input
                type="color"
                value={settings.textColor}
                onChange={(e) => set("textColor", e.target.value)}
              />
              <span className="val">{settings.textColor}</span>
            </div>
          </div>
          <div className="settings-row">
            <label>衬线字体</label>
            <input
              type="checkbox"
              checked={settings.serif}
              onChange={(e) => set("serif", e.target.checked)}
            />
          </div>

          <div style={{ padding: "16px" }}>
            <button className="btn" style={{ width: "100%" }} onClick={onOpenAppSettings}>
              全局默认设置与更多选项
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
