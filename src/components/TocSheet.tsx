import { useMemo, useState } from "react";
import { api } from "../api";
import type { Chapter, Volume } from "../types";
import AiParseDialog from "./AiParseDialog";

interface Props {
  chapters: Chapter[];
  volumes: Volume[];
  currentIdx: number;
  onJump: (idx: number) => void;
  onClose: () => void;
  bookId: string;
  onVolumesChanged: () => void;
  onChaptersChanged: (chs: Chapter[]) => void;
}

/** 解析 "1-100 卷一; 101-200 卷二" 形式的输入 */
function parseRanges(input: string): { title: string; start: number; end: number }[] | null {
  const out: { title: string; start: number; end: number }[] = [];
  for (const seg of input.split(/[;；\n]+/)) {
    const s = seg.trim();
    if (!s) continue;
    const m = s.match(/^(\d+)\s*[-–~～]\s*(\d+)(?:\s+(.+))?$/);
    if (!m) return null;
    const start = parseInt(m[1], 10) - 1;
    const end = parseInt(m[2], 10) - 1;
    if (start < 0 || end < start) return null;
    out.push({ title: m[3]?.trim() || `第${m[1]}-${m[2]}章`, start, end });
  }
  return out.length ? out : null;
}

export default function TocSheet({ chapters, volumes, currentIdx, onJump, onClose, bookId, onVolumesChanged, onChaptersChanged }: Props) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [showCustom, setShowCustom] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [rangeText, setRangeText] = useState("");
  const [error, setError] = useState("");
  const [toastMsg, setToastMsg] = useState("");

  const groups = useMemo(() => {
    if (!volumes.length) return [{ title: null as string | null, chapters }];
    return volumes.map((v) => ({
      title: `${v.title}（${v.start_chapter + 1}~${v.end_chapter + 1}章）`,
      chapters: chapters.slice(v.start_chapter, v.end_chapter + 1),
    }));
  }, [chapters, volumes]);

  const saveCustom = async () => {
    const ranges = parseRanges(rangeText);
    if (!ranges) {
      setError("格式示例：1-100 第一卷; 101-200 第二卷");
      return;
    }
    for (const r of ranges) {
      if (r.end >= chapters.length) {
        setError(`超出范围：本书共 ${chapters.length} 章`);
        return;
      }
    }
    await api.createCustomVolumes(bookId, ranges);
    onVolumesChanged();
    setShowCustom(false);
    setRangeText("");
    setError("");
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-header">
          <span>目录 · 共 {chapters.length} 章</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="icon-btn" onClick={() => setShowAi(true)} title="AI 章节适配">
              AI
            </button>
            <button className="icon-btn" onClick={() => setShowCustom(true)} title="自定义分卷">
              ✎
            </button>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="sheet-body">
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.title && (
                <button
                  className="toc-volume"
                  style={{ width: "100%", textAlign: "left", background: "none" }}
                  onClick={() => setCollapsed({ ...collapsed, [gi]: !collapsed[gi] })}
                >
                  {collapsed[gi] ? "▸" : "▾"} {g.title}
                </button>
              )}
              {!collapsed[gi] &&
                g.chapters.map((c) => (
                  <button
                    key={c.idx}
                    className={`toc-item ${c.idx === currentIdx ? "current" : ""}`}
                    onClick={() => onJump(c.idx)}
                  >
                    {c.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>

      {showAi && (
        <AiParseDialog
          bookId={bookId}
          chapterCount={chapters.length}
          onClose={() => setShowAi(false)}
          onDone={(chs) => onChaptersChanged(chs)}
          showToast={(m) => {
            setToastMsg(m);
            window.setTimeout(() => setToastMsg(""), 2500);
          }}
        />
      )}
      {toastMsg && <div className="toast">{toastMsg}</div>}

      {showCustom && (
        <div className="overlay">
          <div className="dialog">
            <div className="dialog-header">
              <span>自定义分卷</span>
              <button className="icon-btn" onClick={() => setShowCustom(false)}>✕</button>
            </div>
            <div className="dialog-body">
              <div className="field">
                <label>分卷范围（全书共 {chapters.length} 章）</label>
                <textarea
                  rows={4}
                  value={rangeText}
                  placeholder={"1-100 第一卷; 101-200 第二卷; 201-300 第三卷"}
                  onChange={(e) => setRangeText(e.target.value)}
                />
              </div>
              {error && <div style={{ color: "var(--ui-danger)", fontSize: 13 }}>{error}</div>}
            </div>
            <div className="dialog-footer">
              <button className="btn" onClick={() => setShowCustom(false)}>取消</button>
              <button className="btn primary" onClick={saveCustom}>保存</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
