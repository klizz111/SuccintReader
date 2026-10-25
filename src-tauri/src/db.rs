use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

const MIGRATIONS: &str = "
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT DEFAULT '',
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  file_hash TEXT DEFAULT '',
  cover_path TEXT DEFAULT '',
  encoding TEXT DEFAULT 'utf-8',
  cur_chapter INTEGER NOT NULL DEFAULT 0,
  cur_fraction REAL NOT NULL DEFAULT 0,
  last_read_at INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT 0,
  folder_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_books_folder ON books(folder_id);

CREATE TABLE IF NOT EXISTS chapters (
  book_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  offset INTEGER NOT NULL,
  volume_idx INTEGER NOT NULL DEFAULT -1,
  PRIMARY KEY (book_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id);

CREATE TABLE IF NOT EXISTS volumes (
  book_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_chapter INTEGER NOT NULL,
  end_chapter INTEGER NOT NULL,
  is_custom INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, idx)
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tags (
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (book_id, name)
);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_idx INTEGER NOT NULL,
  fraction REAL NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  excerpt TEXT DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
";

pub fn init_db(app_data_dir: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let db_path = app_data_dir.join("succintreader.db");
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "busy_timeout", 5000).map_err(|e| e.to_string())?;
    conn.execute_batch(MIGRATIONS).map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// 供备份使用：把 WAL 内容合并回主数据库文件
pub fn checkpoint(conn: &Connection) -> Result<(), String> {
    conn.pragma_update(None, "wal_checkpoint", "TRUNCATE")
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 读取单条 JSON 设置
pub fn get_setting_json(conn: &Connection, key: &str) -> Option<serde_json::Value> {
    let mut stmt = conn
        .prepare("SELECT value FROM settings WHERE key = ?1")
        .ok()?;
    let val: Option<String> = stmt
        .query_row(params![key], |r| r.get(0))
        .ok();
    val.and_then(|v| serde_json::from_str(&v).ok())
}
