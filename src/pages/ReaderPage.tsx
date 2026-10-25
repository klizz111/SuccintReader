import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Book, BookmarkRow, Chapter, ReaderSettings, Volume } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { applyReaderSettings } from "../theme";
import TocSheet from "../components/TocSheet";
import BookmarkSheet from "../components/BookmarkSheet";
import ReaderSettingsPanel from "../components/ReaderSettingsPanel";

interface Props {
  book: Book;
  onExit: () => void;
  onOpenSettings: () => void;
}

const MAX_CHAPTER_CHARS = 300_000;

export default function ReaderPage({ book, onExit, onOpenSettings }: Props) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [chapterIdx, setChapterIdx] = useState(book.cur_chapter);
  const [text, setText] = useState("");
  const [fileSize, setFileSize] = useState(book.file_size);
  const [pct, setPct] = useState(0);
  const [panel, setPanel] = useState<"toc" | "bookmark" | "settings" | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const [toast, setToast] = useState("");
  const [chromeVisible, setChromeVisible] = useState(true); // 上下菜单栏可见性

  const scrollRef = useRef<HTMLDivElement>(null);
  const chapterIdxRef = useRef(chapterIdx);
  const chaptersRef = useRef(chapters);
  const fileSizeRef = useRef(fileSize);
  const suppressScrollSave = useRef(false);
  const saveTimer = useRef<number>(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const touchMoved = useRef(false);
  const pendingAdvance = useRef(false); // 已到章末，等待再次下滑确认跳章
  const wheelAcc = useRef(0); // 章末滚轮累积量，达到阈值才确认，避免误触

  chapterIdxRef.current = chapterIdx;
  chaptersRef.current = chapters;
  fileSizeRef.current = fileSize;

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1800);
  };

  // 初始加载
  useEffect(() => {
    (async () => {
      const [chs, vols, globalS, bookS, stat, bms] = await Promise.all([
        api.getChapters(book.id),
        api.getVolumes(book.id),
        api.getSettings<Partial<ReaderSettings>>("global"),
        api.getSettings<Partial<ReaderSettings>>(`book:${book.id}`),
        api.getBookFileStat(book.id),
        api.listBookmarks(book.id),
      ]);
      setChapters(chs);
      setVolumes(vols);
      setSettings({ ...DEFAULT_SETTINGS, ...globalS, ...bookS });
      setFileSize(stat.file_size);
      setBookmarks(bms);
      const startIdx = Math.min(book.cur_chapter, Math.max(0, chs.length - 1));
      setChapterIdx(startIdx);
      await loadChapter(startIdx, book.cur_fraction);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  const loadChapter = useCallback(
    async (idx: number, fraction: number) => {
      const chs = chaptersRef.current;
      if (idx < 0 || idx >= chs.length) return;
      const ch = chs[idx];
      const nextOffset = idx + 1 < chs.length ? chs[idx + 1].offset : Number.MAX_SAFE_INTEGER;
      const len = Math.min(nextOffset - ch.offset, MAX_CHAPTER_CHARS * 4);
      // maxChars 为字符上限，maxBytes 为章节字节长度，双重限定确保只读本章节内容
      const { text } = await api.readText(book.id, ch.offset, Math.ceil(len), Math.ceil(len));
      suppressScrollSave.current = true;
      setChapterIdx(idx);
      setText(text);
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) {
          const max = el.scrollHeight - el.clientHeight;
          el.scrollTop = max * Math.min(1, Math.max(0, fraction));
        }
        updatePct(idx, fraction);
        window.setTimeout(() => (suppressScrollSave.current = false), 80);
      });
    },
    [book.id]
  );

  const updatePct = useCallback(
    (idx: number, fraction: number) => {
      const chs = chaptersRef.current;
      const fsz = fileSizeRef.current;
      if (!chs.length || !fsz) return;
      const start = chs[idx].offset;
      const end = idx + 1 < chs.length ? chs[idx + 1].offset : fsz;
      setPct((start + (end - start) * fraction) / fsz);
    },
    []
  );

  const currentFraction = () => {
    const el = scrollRef.current;
    if (!el) return 0;
    const max = el.scrollHeight - el.clientHeight;
    return max <= 0 ? 0 : el.scrollTop / max;
  };

  const saveProgress = useCallback(
    (idx: number, fraction: number) => {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        api.setProgress(book.id, idx, fraction).catch(() => {});
      }, 400);
    },
    [book.id]
  );

  // 滚动 → 进度
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const f = currentFraction();
        updatePct(chapterIdxRef.current, f);
        if (suppressScrollSave.current) return;
        saveProgress(chapterIdxRef.current, f);
        // 滚入章末：标记待确认并提示；向上滚离则取消
        if (!isAtBottom()) {
          pendingAdvance.current = false;
          return;
        }
        if (!pendingAdvance.current) {
          pendingAdvance.current = true;
          showToast("已到本章末尾，再次下滑进入下一章");
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 滑条拖动：字节偏移 → 章节 + 章内比例
  const seekToPct = (p: number) => {
    const target = p * fileSize;
    const chs = chapters;
    let lo = 0;
    let hi = chs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (chs[mid].offset <= target) lo = mid;
      else hi = mid - 1;
    }
    const ch = chs[lo];
    const end = lo + 1 < chs.length ? chs[lo + 1].offset : fileSize;
    const frac = Math.min(1, Math.max(0, (target - ch.offset) / Math.max(1, end - ch.offset)));
    if (lo === chapterIdx) {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = (el.scrollHeight - el.clientHeight) * frac;
      }
      updatePct(lo, frac);
      saveProgress(lo, frac);
    } else {
      loadChapter(lo, frac);
      saveProgress(lo, frac);
    }
  };

  const nextChapter = () => {
    if (chapterIdx + 1 < chapters.length) {
      loadChapter(chapterIdx + 1, 0);
      saveProgress(chapterIdx + 1, 0);
    } else showToast("已经是最后一章");
  };
  const prevChapter = () => {
    if (chapterIdx > 0) {
      loadChapter(chapterIdx - 1, 0);
      saveProgress(chapterIdx - 1, 0);
    } else showToast("已经是第一章");
  };

  // 上/下划微调
  const fineTune = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const lineH = settings.fontSize * settings.lineHeight;
    el.scrollBy({ top: dir * lineH * 3, behavior: "smooth" });
  };

  const isAtBottom = () => {
    const el = scrollRef.current;
    return !!el && el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  };

  // 章末顿挫确认：到达章末后第一次下滑只提示，第二次才真正跳章
  const confirmAdvance = () => {
    if (pendingAdvance.current) {
      pendingAdvance.current = false;
      nextChapter();
    } else {
      pendingAdvance.current = true;
      showToast("已到本章末尾，再次下滑进入下一章");
    }
  };

  // 手势：左右滑切章，上划微调；章末上滑走顿挫确认
  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    touchMoved.current = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = touchStart.current;
    if (!s) return;
    const dx = e.touches[0].clientX - s.x;
    const dy = e.touches[0].clientY - s.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) touchMoved.current = true;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) nextChapter();
      else prevChapter();
    } else if (dy < -50 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      // 章末需明显下滑（≥120px）才确认跳章，避免轻轻一碰就翻章
      if (isAtBottom() && dy < -120) confirmAdvance();
      else if (!isAtBottom()) fineTune(1);
    } else if (dy > 50 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      fineTune(-1);
    }
  };

  // 桌面滚轮：章末向下滚动累积 ≥120px 才确认，单次轻滚不误触
  const onWheel = (e: React.WheelEvent) => {
    if (e.deltaY <= 0 || !isAtBottom()) {
      wheelAcc.current = 0;
      return;
    }
    wheelAcc.current += e.deltaY;
    if (wheelAcc.current >= 120) {
      wheelAcc.current = 0;
      confirmAdvance();
    }
  };

  // 左右点击翻页：点左 1/3 上一页、右 1/3 下一页；整屏全新内容，章首/章末自动切章（无动画）
  const tapPage = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    if (dir === 1) {
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      if (atBottom) {
        nextChapter(); // 本章最后一页继续右点 → 进入下一章
        return;
      }
    } else {
      const atTop = el.scrollTop <= 2;
      if (atTop) {
        prevChapter(); // 本章第一页继续左点 → 返回上一章
        return;
      }
    }
    el.scrollTop += dir * el.clientHeight;
  };
  const onReaderClick = (e: React.MouseEvent) => {
    if (touchMoved.current) {
      touchMoved.current = false; // 滑动/拖动后不触发点击翻页
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (x < 0.3) tapPage(-1);
    else if (x > 0.7) tapPage(1);
    else setChromeVisible((v) => !v); // 点击中央：显示/隐藏上下菜单栏
  };

  // 键盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") nextChapter();
      else if (e.key === "ArrowLeft") prevChapter();
      else if (e.key === "ArrowUp") fineTune(-1);
      else if (e.key === "ArrowDown") fineTune(1);
      else if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIdx, chapters, settings]);

  const paragraphs = useMemo(() => text.split("\n").filter((p) => p.trim()), [text]);

  const jumpToChapter = (idx: number) => {
    setPanel(null);
    loadChapter(idx, 0);
    saveProgress(idx, 0);
  };

  const addBookmark = async () => {
    const el = scrollRef.current;
    const f = currentFraction();
    const lines = el?.innerText.split("\n") ?? [];
    const lineIdx = Math.floor(lines.length * f);
    const excerpt = (lines[lineIdx] ?? "").slice(0, 60);
    const note = window.prompt("书签备注（可留空）") ?? "";
    const bm = await api.addBookmark({
      bookId: book.id,
      chapterIdx: chapterIdxRef.current,
      fraction: f,
      note,
      excerpt,
    });
    setBookmarks([bm, ...bookmarks]);
    showToast("书签已添加");
  };

  // 设置变化时同步到根元素 CSS 变量（进入本页时 App 已预置，这里保持后续修改生效）
  useEffect(() => {
    applyReaderSettings(settings);
  }, [settings]);

  return (
    <div className="reader">
      <div className={`reader-top ${chromeVisible ? "" : "hidden"}`}>
        <button className="icon-btn" style={{ background: "transparent" }} onClick={onExit}>
          ←
        </button>
        <div className="title">
          {book.title} · {chapters[chapterIdx]?.title ?? ""}
        </div>
        <button
          className="icon-btn"
          style={{ background: "transparent" }}
          onClick={() => setPanel("bookmark")}
        >
          🔖
        </button>
        <button
          className="icon-btn"
          style={{ background: "transparent" }}
          onClick={() => setPanel("toc")}
        >
          ☰
        </button>
        <button
          className="icon-btn"
          style={{ background: "transparent" }}
          onClick={() => setPanel("settings")}
        >
          Aa
        </button>
      </div>

      <div
        className="reader-scroll"
        ref={scrollRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
        onClick={onReaderClick}
      >
        <div className="reader-content">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <p style={{ textAlign: "center", textIndent: 0, opacity: 0.5, marginTop: "2em" }}>
            —— 本章完 ——
          </p>
        </div>
      </div>

      <div className={`reader-bottom ${chromeVisible ? "" : "hidden"}`}>
        <div className="slider-row">
          <span className="slider-pct">{Math.round(pct * 100)}%</span>
          <input
            type="range"
            className="progress-slider"
            min={0}
            max={1000}
            value={Math.round(pct * 1000)}
            onChange={(e) => seekToPct(Number(e.target.value) / 1000)}
          />
          <span className="slider-pct">{chapters.length}章</span>
        </div>
        <div className="reader-actions">
          <button onClick={prevChapter}>‹ 上一章</button>
          <button onClick={addBookmark}>＋书签</button>
          <button
            onClick={() => {
              const chs = chaptersRef.current;
              if (chs.length) jumpToChapter(chs.length - 1);
            }}
          >
            最新章
          </button>
          <button onClick={nextChapter}>下一章 ›</button>
        </div>
      </div>

      {panel === "toc" && (
        <TocSheet
          chapters={chapters}
          volumes={volumes}
          currentIdx={chapterIdx}
          onJump={jumpToChapter}
          onClose={() => setPanel(null)}
          bookId={book.id}
          onVolumesChanged={async () => setVolumes(await api.getVolumes(book.id))}
          onChaptersChanged={(chs) => {
            setChapters(chs);
            setVolumes([]);
            const idx = Math.min(chapterIdx, chs.length - 1);
            setChapterIdx(idx);
            loadChapter(idx, 0);
          }}
        />
      )}
      {panel === "bookmark" && (
        <BookmarkSheet
          bookmarks={bookmarks}
          chapterTitle={(i) => chapters[i]?.title ?? `第${i + 1}章`}
          onJump={(bm) => {
            setPanel(null);
            loadChapter(bm.chapter_idx, bm.fraction);
          }}
          onDelete={async (id) => {
            await api.deleteBookmark(id);
            setBookmarks(bookmarks.filter((b) => b.id !== id));
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "settings" && (
        <ReaderSettingsPanel
          settings={settings}
          onChange={(s) => {
            setSettings(s);
            api.saveSettings(`book:${book.id}`, s).catch(() => {});
          }}
          onClose={() => setPanel(null)}
          onOpenAppSettings={onOpenSettings}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
