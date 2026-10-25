import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { AiConfig, Chapter } from "../types";
import { DEFAULT_AI_PROMPT } from "../types";

interface Props {
  bookId: string;
  chapterCount: number;
  onClose: () => void;
  onDone: (chapters: Chapter[]) => void;
  showToast: (msg: string) => void;
}

const SAMPLE_CHARS = 1_000_000; // 采样前 100 万字符（约 200~300 万字节的 UTF-8 文本）

/** 从响应 JSON 中提取 [{title, offset}] */
function extractChapters(data: unknown): { title: string; offset: number }[] | null {
  let arr: unknown = data;
  if (typeof data === "string") {
    try {
      arr = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (Array.isArray(arr)) {
    const out = arr
      .map((x) => {
        if (Array.isArray(x)) return { title: String(x[0]), offset: Number(x[1]) };
        if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          return {
            title: String(o.title ?? o.name ?? ""),
            offset: Number(o.offset ?? o.index ?? o.pos ?? NaN),
          };
        }
        return null;
      })
      .filter((x): x is { title: string; offset: number } =>
        !!x && !!x.title && Number.isFinite(x.offset) && x.offset >= 0
      );
    return out.length ? out : null;
  }
  return null;
}

export default function AiParseDialog({ bookId, chapterCount, onClose, onDone, showToast }: Props) {
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_AI_PROMPT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 载入已保存配置
  useEffect(() => {
    api.getSettings<Partial<AiConfig>>("ai").then((cfg) => {
      if (cfg.endpoint) setEndpoint(cfg.endpoint);
      if (cfg.apiKey) setApiKey(cfg.apiKey);
      if (cfg.prompt) setPrompt(cfg.prompt);
    });
  }, []);

  const run = async () => {
    if (!endpoint.trim()) {
      setError("请输入 API 端点");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.saveSettings("ai", { endpoint, apiKey, prompt });
      const { text } = await api.readText(bookId, 0, SAMPLE_CHARS);
      const resp = await tauriFetch(endpoint.trim(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ text, prompt, task: "chapter_split" }),
        connectTimeout: 60_000,
      });
      if (!resp.ok) throw new Error(`API 返回 ${resp.status}`);
      const data = await resp.json();
      const items = extractChapters(data);
      if (!items) throw new Error("无法解析 API 响应，期望 JSON 数组 [{title, offset}]");

      // 字符偏移 → UTF-8 字节偏移
      const enc = new TextEncoder();
      const chapters: Chapter[] = [];
      let cursor = 0;
      let byteCursor = 0;
      const sorted = [...items].sort((a, b) => a.offset - b.offset);
      for (const it of sorted) {
        if (it.offset < cursor || it.offset >= text.length) continue;
        byteCursor += enc.encode(text.slice(cursor, it.offset)).length;
        cursor = it.offset;
        chapters.push({ idx: chapters.length, title: it.title.slice(0, 80), offset: byteCursor });
      }
      if (chapters.length < 2) throw new Error("AI 未识别出有效章节，已保留原有目录");
      if (text.length >= SAMPLE_CHARS) {
        showToast(`仅前 ${SAMPLE_CHARS} 字符参与 AI 划分，后续章节可能缺失`);
      }
      await api.replaceChapters(bookId, chapters);
      onDone(chapters);
      showToast(`AI 划分完成：${chapters.length} 章（原 ${chapterCount} 章）`);
      onClose();
    } catch (e) {
      setError(String(e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span>AI 章节适配</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="dialog-body">
          <div className="field">
            <label>API 端点（POST，接收 {"{text, prompt}"}，返回 [{"{title, offset}"}]）</label>
            <input
              value={endpoint}
              placeholder="https://api.example.com/chapter-split"
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </div>
          <div className="field">
            <label>API Key（可选，以 Bearer 方式发送）</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Prompt（随请求体发送）</label>
            <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>
          {error && <div style={{ color: "var(--ui-danger)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
          <div className="progress-text">
            说明：将发送本书前 100 万字符，返回的 offset 为字符下标，应用会自动换算为字节偏移。失败不会破坏现有目录。
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={busy} onClick={run}>
            {busy ? "解析中…" : "开始解析"}
          </button>
        </div>
      </div>
    </div>
  );
}
