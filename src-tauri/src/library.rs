use crate::book::{self, ChapterParse, VolumeParse};
use crate::db::{get_setting_json, new_id, now_ms, DbState};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

#[derive(Serialize, Clone)]
pub struct BookRow {
    pub id: String,
    pub title: String,
    pub author: String,
    pub file_path: String,
    pub file_size: i64,
    pub file_hash: String,
    pub cover_path: String,
    pub encoding: String,
    pub cur_chapter: i64,
    pub cur_fraction: f64,
    pub last_read_at: i64,
    pub added_at: i64,
    pub folder_id: Option<String>,
    pub tags: Vec<String>,
}

fn book_from_row(row: &rusqlite::Row) -> rusqlite::Result<BookRow> {
    Ok(BookRow {
        id: row.get(0)?,
        title: row.get(1)?,
        author: row.get(2)?,
        file_path: row.get(3)?,
        file_size: row.get(4)?,
        file_hash: row.get(5)?,
        cover_path: row.get(6).unwrap_or_default(),
        encoding: row.get(7)?,
        cur_chapter: row.get(8)?,
        cur_fraction: row.get(9)?,
        last_read_at: row.get(10)?,
        added_at: row.get(11)?,
        folder_id: row.get(12)?,
        tags: Vec::new(),
    })
}

const BOOK_COLS: &str =
    "id, title, author, file_path, file_size, file_hash, cover_path, encoding, cur_chapter, cur_fraction, last_read_at, added_at, folder_id";

fn attach_tags(conn: &rusqlite::Connection, books: &mut [BookRow]) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT name FROM tags WHERE book_id = ?1 ORDER BY name")
        .map_err(|e| e.to_string())?;
    for b in books.iter_mut() {
        let rows = stmt
            .query_map(params![b.id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        b.tags = rows.filter_map(|r| r.ok()).collect();
    }
    Ok(())
}

fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct ImportResult {
    pub book: BookRow,
    pub chapters: Vec<ChapterParse>,
    pub volumes: Vec<VolumeParse>,
}

#[tauri::command]
pub fn import_book(
    app: tauri::AppHandle,
    state: tauri::State<DbState>,
    source_path: String,
) -> Result<ImportResult, String> {
    let src = Path::new(&source_path);
    if !src.exists() {
        return Err("文件不存在".into());
    }
    let bytes = fs::read(src).map_err(|e| format!("读取失败: {e}"))?;
    let hash = hex::encode(Sha256::digest(&bytes));

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // 已导入过（按 hash 去重），直接返回现有记录
    if let Ok(existing) = conn.query_row(
        &format!("SELECT {BOOK_COLS} FROM books WHERE file_hash = ?1"),
        params![hash],
        |r| book_from_row(r),
    ) {
        let mut book = existing;
        let chapters = get_chapters_inner(&conn, &book.id)?;
        let volumes = get_volumes_inner(&conn, &book.id)?;
        attach_tags(&conn, std::slice::from_mut(&mut book))?;
        return Ok(ImportResult {
            book,
            chapters,
            volumes,
        });
    }
    drop(conn);

    // 转码 UTF-16 → UTF-8 存储
    let (store_bytes, encoding) = book::normalize_to_utf8(&bytes);
    let dir = data_dir(&app)?.join("books");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let id = new_id();
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("txt")
        .to_string();
    let file_path = dir.join(format!("{id}.{ext}"));
    fs::write(&file_path, &store_bytes).map_err(|e| format!("写入失败: {e}"))?;

    let parsed = book::parse_book(file_path.to_str().unwrap())?;

    let title = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("未命名")
        .to_string();

    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO books (id, title, author, file_path, file_size, file_hash, encoding, added_at)
         VALUES (?1,?2,'',?3,?4,?5,?6,?7)",
        params![
            id,
            title,
            file_path.to_string_lossy(),
            store_bytes.len() as i64,
            hash,
            encoding.name(),
            now_ms()
        ],
    )
    .map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("INSERT INTO chapters (book_id, idx, title, offset, volume_idx) VALUES (?1,?2,?3,?4,?5)")
            .map_err(|e| e.to_string())?;
        for c in &parsed.chapters {
            let vol_idx = parsed
                .volumes
                .iter()
                .position(|v| c.idx >= v.start_chapter && c.idx <= v.end_chapter)
                .map(|i| i as i64)
                .unwrap_or(-1);
            stmt.execute(params![id, c.idx, c.title, c.offset as i64, vol_idx])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    let mut b = conn
        .query_row(
            &format!("SELECT {BOOK_COLS} FROM books WHERE id = ?1"),
            params![id],
            |r| book_from_row(r),
        )
        .map_err(|e| e.to_string())?;
    attach_tags(&conn, std::slice::from_mut(&mut b))?;

    Ok(ImportResult {
        book: b,
        chapters: parsed.chapters,
        volumes: parsed.volumes,
    })
}

#[tauri::command]
pub fn list_books(
    state: tauri::State<DbState>,
    folder_id: Option<String>,
) -> Result<Vec<BookRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut books: Vec<BookRow> = match folder_id {
        Some(fid) => {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT {BOOK_COLS} FROM books WHERE folder_id = ?1 ORDER BY added_at DESC"
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![fid], |r| book_from_row(r))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        }
        None => {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT {BOOK_COLS} FROM books ORDER BY last_read_at DESC, added_at DESC"
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| book_from_row(r)).map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        }
    };
    attach_tags(&conn, &mut books)?;
    Ok(books)
}

#[tauri::command]
pub fn search_books(state: tauri::State<DbState>, query: String) -> Result<Vec<BookRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let q = format!("%{query}%");
    let mut stmt = conn
        .prepare(&format!(
            "SELECT DISTINCT {BOOK_COLS} FROM books
             LEFT JOIN tags ON tags.book_id = books.id
             WHERE books.title LIKE ?1 OR books.author LIKE ?1 OR tags.name LIKE ?1
             ORDER BY books.last_read_at DESC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![q], |r| book_from_row(r))
        .map_err(|e| e.to_string())?;
    let mut books: Vec<BookRow> = rows.filter_map(|r| r.ok()).collect();
    attach_tags(&conn, &mut books)?;
    Ok(books)
}

#[tauri::command]
pub fn update_book(
    state: tauri::State<DbState>,
    id: String,
    title: Option<String>,
    author: Option<String>,
    folder_id: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(t) = title {
        conn.execute("UPDATE books SET title = ?1 WHERE id = ?2", params![t, id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(a) = author {
        conn.execute("UPDATE books SET author = ?1 WHERE id = ?2", params![a, id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(f) = folder_id {
        if f.is_empty() {
            conn.execute("UPDATE books SET folder_id = NULL WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
        } else {
            conn.execute("UPDATE books SET folder_id = ?1 WHERE id = ?2", params![f, id])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_book(
    _app: tauri::AppHandle,
    state: tauri::State<DbState>,
    id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (fp, cp): (String, String) = conn
        .query_row(
            "SELECT file_path, cover_path FROM books WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0).unwrap_or_default(), r.get(1).unwrap_or_default())),
        )
        .map_err(|e| e.to_string())?;
    for sql in [
        "DELETE FROM chapters WHERE book_id = ?1",
        "DELETE FROM volumes WHERE book_id = ?1",
        "DELETE FROM tags WHERE book_id = ?1",
        "DELETE FROM bookmarks WHERE book_id = ?1",
        "DELETE FROM books WHERE id = ?1",
    ] {
        conn.execute(sql, params![id]).map_err(|e| e.to_string())?;
    }
    drop(conn);
    for p in [fp, cp] {
        if !p.is_empty() {
            let _ = fs::remove_file(p);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_cover(
    app: tauri::AppHandle,
    state: tauri::State<DbState>,
    id: String,
    image_path: String,
) -> Result<String, String> {
    let src = Path::new(&image_path);
    if !src.exists() {
        return Err("图片不存在".into());
    }
    let dir = data_dir(&app)?.join("covers");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_string();
    let dest = dir.join(format!("{id}.{ext}"));
    fs::copy(src, &dest).map_err(|e| e.to_string())?;
    let dest_str = dest.to_string_lossy().to_string();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE books SET cover_path = ?1 WHERE id = ?2",
        params![dest_str, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(dest_str)
}

#[tauri::command]
pub fn set_progress(
    state: tauri::State<DbState>,
    id: String,
    chapter_idx: i64,
    fraction: f64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE books SET cur_chapter = ?1, cur_fraction = ?2, last_read_at = ?3 WHERE id = ?4",
        params![chapter_idx, fraction, now_ms(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_chapters_inner(
    conn: &rusqlite::Connection,
    book_id: &str,
) -> Result<Vec<ChapterParse>, String> {
    let mut stmt = conn
        .prepare("SELECT idx, title, offset FROM chapters WHERE book_id = ?1 ORDER BY idx")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![book_id], |r| {
            Ok(ChapterParse {
                idx: r.get(0)?,
                title: r.get(1)?,
                offset: r.get::<_, i64>(2)? as u64,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn get_chapters(
    state: tauri::State<DbState>,
    book_id: String,
) -> Result<Vec<ChapterParse>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_chapters_inner(&conn, &book_id)
}

fn get_volumes_inner(
    conn: &rusqlite::Connection,
    book_id: &str,
) -> Result<Vec<VolumeParse>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT idx, title, start_chapter, end_chapter FROM volumes WHERE book_id = ?1 ORDER BY idx",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![book_id], |r| {
            Ok(VolumeParse {
                idx: r.get(0)?,
                title: r.get(1)?,
                start_chapter: r.get(2)?,
                end_chapter: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn get_volumes(
    state: tauri::State<DbState>,
    book_id: String,
) -> Result<Vec<VolumeParse>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_volumes_inner(&conn, &book_id)
}

/// 用户自定义分卷：ranges = [{title, start, end}]
#[tauri::command]
pub fn create_custom_volumes(
    state: tauri::State<DbState>,
    book_id: String,
    ranges: Vec<Value>,
) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM volumes WHERE book_id = ?1 AND is_custom = 1",
        params![book_id],
    )
    .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("INSERT INTO volumes (book_id, idx, title, start_chapter, end_chapter, is_custom) VALUES (?1,?2,?3,?4,?5,1)")
            .map_err(|e| e.to_string())?;
        for (i, r) in ranges.iter().enumerate() {
            stmt.execute(params![
                book_id,
                i as i64,
                r["title"].as_str().unwrap_or("未命名"),
                r["start"].as_i64().unwrap_or(0),
                r["end"].as_i64().unwrap_or(0)
            ])
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// AI / 手动重新划分章节：整体替换章节表
#[tauri::command]
pub fn replace_chapters(
    state: tauri::State<DbState>,
    book_id: String,
    chapters: Vec<ChapterParse>,
) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chapters WHERE book_id = ?1", params![book_id])
        .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("INSERT INTO chapters (book_id, idx, title, offset) VALUES (?1,?2,?3,?4)")
            .map_err(|e| e.to_string())?;
        for c in &chapters {
            stmt.execute(params![book_id, c.idx, c.title, c.offset as i64])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct FolderRow {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

#[tauri::command]
pub fn list_folders(state: tauri::State<DbState>) -> Result<Vec<FolderRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, parent_id FROM folders ORDER BY created_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(FolderRow {
                id: r.get(0)?,
                name: r.get(1)?,
                parent_id: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn create_folder(
    state: tauri::State<DbState>,
    name: String,
    parent_id: Option<String>,
) -> Result<FolderRow, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = new_id();
    let pid = parent_id.filter(|p| !p.is_empty());
    conn.execute(
        "INSERT INTO folders (id, name, parent_id, created_at) VALUES (?1,?2,?3,?4)",
        params![id, name, pid, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(FolderRow {
        id,
        name,
        parent_id: pid,
    })
}

#[tauri::command]
pub fn rename_folder(state: tauri::State<DbState>, id: String, name: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE folders SET name = ?1 WHERE id = ?2", params![name, id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_folder(state: tauri::State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE books SET folder_id = NULL WHERE folder_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("UPDATE folders SET parent_id = NULL WHERE parent_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_book_tags(
    state: tauri::State<DbState>,
    book_id: String,
    tags: Vec<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tags WHERE book_id = ?1", params![book_id])
        .map_err(|e| e.to_string())?;
    for t in tags {
        let t = t.trim();
        if !t.is_empty() {
            conn.execute(
                "INSERT OR IGNORE INTO tags (book_id, name) VALUES (?1,?2)",
                params![book_id, t],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct BookmarkRow {
    pub id: String,
    pub book_id: String,
    pub chapter_idx: i64,
    pub fraction: f64,
    pub note: String,
    pub excerpt: String,
    pub created_at: i64,
}

#[tauri::command]
pub fn list_bookmarks(
    state: tauri::State<DbState>,
    book_id: String,
) -> Result<Vec<BookmarkRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, book_id, chapter_idx, fraction, note, excerpt, created_at FROM bookmarks WHERE book_id = ?1 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![book_id], |r| {
            Ok(BookmarkRow {
                id: r.get(0)?,
                book_id: r.get(1)?,
                chapter_idx: r.get(2)?,
                fraction: r.get(3)?,
                note: r.get(4)?,
                excerpt: r.get(5)?,
                created_at: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn add_bookmark(
    state: tauri::State<DbState>,
    book_id: String,
    chapter_idx: i64,
    fraction: f64,
    note: String,
    excerpt: String,
) -> Result<BookmarkRow, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = new_id();
    let ts = now_ms();
    conn.execute(
        "INSERT INTO bookmarks (id, book_id, chapter_idx, fraction, note, excerpt, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![id, book_id, chapter_idx, fraction, note, excerpt, ts],
    )
    .map_err(|e| e.to_string())?;
    Ok(BookmarkRow {
        id,
        book_id,
        chapter_idx,
        fraction,
        note,
        excerpt,
        created_at: ts,
    })
}

#[tauri::command]
pub fn delete_bookmark(state: tauri::State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: tauri::State<DbState>, key: String) -> Result<Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    Ok(get_setting_json(&conn, &key).unwrap_or_else(|| json!({})))
}

/// 合并式保存：传入对象与已有设置合并
#[tauri::command]
pub fn save_settings(
    state: tauri::State<DbState>,
    key: String,
    value: Value,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut merged = get_setting_json(&conn, &key).unwrap_or_else(|| json!({}));
    if let (Some(m), Value::Object(incoming)) = (merged.as_object_mut(), &value) {
        for (k, v) in incoming {
            m.insert(k.clone(), v.clone());
        }
        merged = Value::Object(m.clone());
    } else {
        merged = value;
    }
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, serde_json::to_string(&merged).unwrap()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct TextChunk {
    pub text: String,
}

#[tauri::command]
pub fn read_text(
    state: tauri::State<DbState>,
    book_id: String,
    offset: i64,
    max_chars: i64,
    max_bytes: i64,
) -> Result<TextChunk, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let (fp, enc): (String, String) = conn
        .query_row(
            "SELECT file_path, encoding FROM books WHERE id = ?1",
            params![book_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let text = book::read_at(&fp, offset as u64, max_chars as usize, &enc, max_bytes as u64)?;
    Ok(TextChunk { text })
}

#[derive(Serialize)]
pub struct BookFileStat {
    pub file_size: i64,
    pub encoding: String,
}

#[tauri::command]
pub fn get_book_file_stat(
    state: tauri::State<DbState>,
    book_id: String,
) -> Result<BookFileStat, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT file_size, encoding FROM books WHERE id = ?1",
        params![book_id],
        |r| {
            Ok(BookFileStat {
                file_size: r.get(0)?,
                encoding: r.get(1)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[allow(unused)]
#[derive(Deserialize)]
pub struct AiChapterInput {
    pub title: String,
    pub offset: u64,
}
