import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Book, FolderRow } from "../types";
import BookCard from "../components/BookCard";
import BookDetailDialog from "../components/BookDetailDialog";

interface Props {
  tick: number;
  onOpenBook: (book: Book) => void;
  onOpenSettings: () => void;
}

export default function ShelfPage({ tick, onOpenBook, onOpenSettings }: Props) {
  const [books, setBooks] = useState<Book[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [detailBook, setDetailBook] = useState<Book | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number>(0);

  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2200);
  };

  const refresh = useCallback(async () => {
    const [b, f] = await Promise.all([api.listBooks(null), api.listFolders()]);
    setBooks(b);
    setFolders(f);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, tick]);

  useEffect(() => {
    if (!query.trim()) {
      setSearching(false);
      refresh();
      return;
    }
    const t = window.setTimeout(async () => {
      setBooks(await api.searchBooks(query.trim()));
      setSearching(true);
    }, 250);
    return () => window.clearTimeout(t);
  }, [query, refresh]);

  const visible = useMemo(() => {
    if (searching || query.trim()) return books;
    if (currentFolder === null) return books.filter((b) => !b.folder_id);
    return books.filter((b) => b.folder_id === currentFolder);
  }, [books, currentFolder, searching, query]);

  const importBooks = async () => {
    const paths = await open({
      multiple: true,
      filters: [{ name: "TXT 文本", extensions: ["txt", "text"] }],
    });
    if (!paths) return;
    let ok = 0;
    for (const p of Array.isArray(paths) ? paths : [paths]) {
      try {
        await api.importBook(p);
        ok++;
      } catch (e) {
        showToast(`导入失败: ${String(e).slice(0, 60)}`);
      }
    }
    if (ok) showToast(`成功导入 ${ok} 本书`);
    await refresh();
  };

  const createFolder = async () => {
    const name = window.prompt("文件夹名称");
    if (!name?.trim()) return;
    await api.createFolder(name.trim(), currentFolder);
    await refresh();
  };

  return (
    <div className="shelf">
      <div className="topbar">
        {currentFolder !== null && (
          <button className="icon-btn" onClick={() => setCurrentFolder(null)}>
            ←
          </button>
        )}
        <h1>
          {searching
            ? "搜索结果"
            : currentFolder
              ? (folders.find((f) => f.id === currentFolder)?.name ?? "书架")
              : "书架"}
        </h1>
        <input
          className="search-input"
          placeholder="搜索书名 / 作者 / 标签"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="icon-btn" title="导入 txt" onClick={importBooks}>
          ＋
        </button>
        <button className="icon-btn" title="设置" onClick={onOpenSettings}>
          ⚙
        </button>
      </div>

      <div className="folder-tabs">
        <button
          className={`folder-tab ${currentFolder === null && !searching ? "active" : ""}`}
          onClick={() => setCurrentFolder(null)}
        >
          未归档
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            className={`folder-tab ${currentFolder === f.id ? "active" : ""}`}
            onClick={() => setCurrentFolder(f.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (window.confirm(`删除文件夹“${f.name}”？（书本会移出，不会删除）`)) {
                api.deleteFolder(f.id).then(refresh);
              }
            }}
          >
            📁 {f.name}
          </button>
        ))}
        <button className="folder-tab" onClick={createFolder}>
          ＋ 新建文件夹
        </button>
      </div>

      <div className="book-grid">
        {visible.length === 0 && (
          <div className="empty-hint">
            {query.trim() ? "没有找到匹配的书" : "书架是空的，点击右上角 ＋ 导入 txt 小说"}
          </div>
        )}
        {visible.map((b) => (
          <BookCard
            key={b.id}
            book={b}
            onOpen={() => onOpenBook(b)}
            onDetail={() => setDetailBook(b)}
          />
        ))}
      </div>

      {detailBook && (
        <BookDetailDialog
          book={detailBook}
          folders={folders}
          onClose={() => setDetailBook(null)}
          onChanged={async () => {
            await refresh();
            setDetailBook(null);
          }}
          onOpen={() => {
            onOpenBook(detailBook);
            setDetailBook(null);
          }}
          showToast={showToast}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
