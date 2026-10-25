import { invoke } from "@tauri-apps/api/core";
import type {
  Book,
  BookmarkRow,
  Chapter,
  FolderRow,
  Volume,
} from "./types";

export const api = {
  importBook: (sourcePath: string) =>
    invoke<{ book: Book; chapters: Chapter[]; volumes: Volume[] }>("import_book", { sourcePath }),

  listBooks: (folderId?: string | null) =>
    invoke<Book[]>("list_books", { folderId: folderId ?? null }),

  searchBooks: (query: string) => invoke<Book[]>("search_books", { query }),

  updateBook: (id: string, patch: { title?: string; author?: string; folderId?: string | null }) =>
    invoke<void>("update_book", { id, ...patch }),

  deleteBook: (id: string) => invoke<void>("delete_book", { id }),

  setCover: (id: string, imagePath: string) =>
    invoke<string>("set_cover", { id, imagePath }),

  setProgress: (id: string, chapterIdx: number, fraction: number) =>
    invoke<void>("set_progress", { id, chapterIdx, fraction }),

  getChapters: (bookId: string) => invoke<Chapter[]>("get_chapters", { bookId }),

  getVolumes: (bookId: string) => invoke<Volume[]>("get_volumes", { bookId }),

  createCustomVolumes: (bookId: string, ranges: { title: string; start: number; end: number }[]) =>
    invoke<void>("create_custom_volumes", { bookId, ranges }),

  replaceChapters: (bookId: string, chapters: Chapter[]) =>
    invoke<void>("replace_chapters", { bookId, chapters }),

  listFolders: () => invoke<FolderRow[]>("list_folders"),

  createFolder: (name: string, parentId?: string | null) =>
    invoke<FolderRow>("create_folder", { name, parentId: parentId ?? null }),

  renameFolder: (id: string, name: string) =>
    invoke<void>("rename_folder", { id, name }),

  deleteFolder: (id: string) => invoke<void>("delete_folder", { id }),

  setBookTags: (bookId: string, tags: string[]) =>
    invoke<void>("set_book_tags", { bookId, tags }),

  listBookmarks: (bookId: string) =>
    invoke<BookmarkRow[]>("list_bookmarks", { bookId }),

  addBookmark: (b: { bookId: string; chapterIdx: number; fraction: number; note: string; excerpt: string }) =>
    invoke<BookmarkRow>("add_bookmark", {
      bookId: b.bookId,
      chapterIdx: b.chapterIdx,
      fraction: b.fraction,
      note: b.note,
      excerpt: b.excerpt,
    }),

  deleteBookmark: (id: string) => invoke<void>("delete_bookmark", { id }),

  getSettings: <T>(key: string) => invoke<T>("get_settings", { key }),

  saveSettings: (key: string, value: unknown) =>
    invoke<void>("save_settings", { key, value }),

  readText: (bookId: string, offset: number, maxChars: number) =>
    invoke<{ text: string }>("read_text", { bookId, offset, maxChars }),

  getBookFileStat: (bookId: string) =>
    invoke<{ file_size: number; encoding: string }>("get_book_file_stat", { bookId }),

  exportBackup: (targetPath: string) =>
    invoke<void>("export_backup", { targetPath }),

  importBackup: (sourcePath: string) =>
    invoke<{ books_imported: number; skipped: number; files_copied: number }>("import_backup", { sourcePath }),
};
