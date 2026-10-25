export interface Book {
  id: string;
  title: string;
  author: string;
  file_path: string;
  file_size: number;
  file_hash: string;
  cover_path: string;
  encoding: string;
  cur_chapter: number;
  cur_fraction: number;
  last_read_at: number;
  added_at: number;
  folder_id: string | null;
  tags: string[];
}

export interface Chapter {
  idx: number;
  title: string;
  offset: number;
}

export interface Volume {
  idx: number;
  title: string;
  start_chapter: number;
  end_chapter: number;
}

export interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface BookmarkRow {
  id: string;
  book_id: string;
  chapter_idx: number;
  fraction: number;
  note: string;
  excerpt: string;
  created_at: number;
}

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
  bgColor: string;
  textColor: string;
  serif: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  paddingX: 20,
  paddingY: 24,
  bgColor: "#f5f0e6",
  textColor: "#3a3226",
  serif: true,
};

export interface AiConfig {
  endpoint: string;
  apiKey: string;
  prompt: string;
}

export const DEFAULT_AI_PROMPT =
  "你是文本章节划分助手。给定小说文本，找出所有章节标题，返回 JSON 数组：[{\"title\": \"章节标题\", \"offset\": 字符偏移量}]。offset 必须是该标题在文本中的字符下标，按出现顺序排列。";
