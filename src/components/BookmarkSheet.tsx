import type { BookmarkRow } from "../types";

interface Props {
  bookmarks: BookmarkRow[];
  chapterTitle: (idx: number) => string;
  onJump: (bm: BookmarkRow) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function BookmarkSheet({ bookmarks, chapterTitle, onJump, onDelete, onClose }: Props) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-header">
          <span>书签 · 共 {bookmarks.length} 条</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="sheet-body">
          {bookmarks.length === 0 && (
            <div className="empty-hint">暂无书签，阅读时点击底部「＋书签」添加</div>
          )}
          {bookmarks.map((bm) => (
            <div key={bm.id} className="bm-item" onClick={() => onJump(bm)}>
              <div className="bm-excerpt">
                <div>{bm.excerpt || "（无摘录）"}</div>
                <div className="bm-note">
                  {chapterTitle(bm.chapter_idx)}
                  {bm.note ? ` · ${bm.note}` : ""} ·{" "}
                  {new Date(bm.created_at).toLocaleDateString()}
                </div>
              </div>
              <button
                className="bm-del"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(bm.id);
                }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
