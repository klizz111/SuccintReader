export type UiTheme = "auto" | "light" | "dark";

import type { ReaderSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { api } from "./api";

const STORAGE_KEY = "sr-ui-theme";

export function getStoredTheme(): UiTheme {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : "auto";
}

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 把主题应用到根元素（data-theme），并返回实际生效的主题 */
export function applyTheme(mode: UiTheme): "light" | "dark" {
  const resolved = mode === "auto" ? systemTheme() : mode;
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

/** 保存用户选择并立即应用 */
export function setTheme(mode: UiTheme): "light" | "dark" {
  localStorage.setItem(STORAGE_KEY, mode);
  return applyTheme(mode);
}

/**
 * 启动时调用一次：
 * - 应用存储的偏好（默认 auto）
 * - 监听设备主题变化，auto 模式下实时跟随
 * - 返回取消监听函数
 */
export function initTheme(): () => void {
  applyTheme(getStoredTheme());
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (getStoredTheme() === "auto") applyTheme("auto");
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** 把阅读设置写到根元素的 --reader-* CSS 变量，进入阅读页之前调用可避免主题闪烁 */
export function applyReaderSettings(s: ReaderSettings): void {
  const el = document.documentElement.style;
  el.setProperty("--reader-bg", s.bgColor);
  el.setProperty("--reader-fg", s.textColor);
  el.setProperty("--reader-font-size", `${s.fontSize}px`);
  el.setProperty("--reader-line-height", String(s.lineHeight));
  el.setProperty("--reader-pad-x", `${s.paddingX}px`);
  el.setProperty("--reader-pad-y", `${s.paddingY}px`);
  el.setProperty(
    "--reader-font-family",
    s.serif
      ? '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif'
      : '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  );
}

/** 读取合并后的阅读设置（全局默认 + 单书覆盖） */
export async function loadReaderSettings(bookId: string): Promise<ReaderSettings> {
  const [g, b] = await Promise.all([
    api.getSettings<Partial<ReaderSettings>>("global"),
    api.getSettings<Partial<ReaderSettings>>(`book:${bookId}`),
  ]);
  return { ...DEFAULT_SETTINGS, ...g, ...b };
}
