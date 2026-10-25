export type UiTheme = "auto" | "light" | "dark";

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
