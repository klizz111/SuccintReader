import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { api } from "../api";
import type { Book, FolderRow } from "../types";

interface Props {
  book: Book;
  folders: FolderRow[];
  onClose: () => void;
  onChanged: () => void;
  onOpen: () => void;
  showToast: (msg: string) => void;
}

export default function BookDetailDialog({ book, folders, onClose, onChanged, onOpen, showToast }: Props) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [folderId, setFolderId] = useState(book.folder_id ?? "");
  const [tags, setTags] = useState<string[]>(book.tags);
  const [tagInput, setTagInput] = useState("");

  const save = async () => {
    await api.updateBook(book.id, {
      title: title.trim() || book.title,
      author: author.trim(),
      folderId: folderId || null,
    });
    await api.setBookTags(book.id, tags);
    onChanged();
  };

  const pickCover = async () => {
    const path = await open({
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (typeof path !== "string") return;
    await api.setCover(book.id, path);
    showToast("封面已更新");
    onChanged();
  };

  const removeBook = async () => {
    if (!window.confirm(`确定删除《${book.title}》？书签和阅读进度将一并删除。`)) return;
    await api.deleteBook(book.id);
    onChanged();
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span>书籍详情</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="dialog-body">
          <div className="field">
            <label>书名</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>作者</label>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div className="field">
            <label>所在文件夹</label>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">未归档</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>标签（回车添加）</label>
            <div className="tag-row">
              {tags.map((t) => (
                <button
                  key={t}
                  className="tag-chip on"
                  onClick={() => setTags(tags.filter((x) => x !== t))}
                  title="点击移除"
                >
                  {t} ✕
                </button>
              ))}
            </div>
            <input
              value={tagInput}
              placeholder="输入标签后回车"
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTag()}
            />
          </div>
          <div className="field">
            <label>自定义封面</label>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={pickCover}>选择图片</button>
              {book.cover_path && (
                <button
                  className="btn"
                  onClick={async () => {
                    await api.updateBook(book.id, {});
                    await api.setCover(book.id, "");
                    onChanged();
                  }}
                >
                  恢复默认
                </button>
              )}
            </div>
          </div>
          <div className="progress-text">
            文件大小 {(book.file_size / 1024 / 1024).toFixed(2)} MB · 编码 {book.encoding}
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn danger" onClick={removeBook}>删除</button>
          <button className="btn" onClick={onOpen}>开始阅读</button>
          <button className="btn primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
