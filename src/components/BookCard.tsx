import { useEffect, useState } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import type { Book } from "../types";

async function loadCoverUrl(coverPath: string): Promise<string | null> {
  if (!coverPath) return null;
  try {
    const bytes = await readFile(coverPath);
    const ext = coverPath.split(".").pop()?.toLowerCase() ?? "png";
    const mime =
      ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
    const blob = new Blob([bytes as unknown as ArrayBuffer], { type: mime });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

interface Props {
  book: Book;
  onOpen: () => void;
  onDetail: () => void;
}

export default function BookCard({ book, onOpen, onDetail }: Props) {
  const [cover, setCover] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    loadCoverUrl(book.cover_path).then((u) => {
      if (alive) setCover(u);
      url = u;
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [book.cover_path]);

  const pct = book.cur_chapter > 0 || book.cur_fraction > 0
    ? Math.min(100, Math.round(((book.cur_chapter + book.cur_fraction) / 10) * 100))
    : 0;

  return (
    <div
      className="book-card"
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onDetail();
      }}
    >
      <div className="book-cover">
        {cover ? <img src={cover} alt="" /> : book.title.slice(0, 1)}
        {pct > 0 && <div className="book-progress-fill" style={{ position: "absolute", bottom: 0, left: 0, width: `${pct}%`, height: 3, background: "rgba(255,255,255,0.9)" }} />}
      </div>
      <div className="book-title" title={book.title}>
        {book.title}
      </div>
      <div className="book-meta">
        {book.author || (book.tags.length ? `#${book.tags.join(" #")}` : "")}
      </div>
    </div>
  );
}
