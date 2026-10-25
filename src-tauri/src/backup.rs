use crate::db::{checkpoint, DbState};
use flate2::{write::GzEncoder, Compression, read::GzDecoder};
use rusqlite::params;
use serde::Serialize;
use serde_json::json;
use std::fs::{self, File};
use std::io::{copy, BufReader, BufWriter};
use std::path::PathBuf;
use tar::{Archive, Builder};
use tauri::Manager;
use uuid::Uuid;

const FORMAT_VERSION: u32 = 1;

#[derive(Serialize)]
pub struct BackupStats {
    pub books_imported: usize,
    pub skipped: usize,
    pub files_copied: usize,
}

fn manifest() -> serde_json::Value {
    json!({
        "app": "succintreader",
        "format_version": FORMAT_VERSION,
        "created_at": crate::db::now_ms(),
        "device": std::env::consts::OS,
    })
}

/// 导出备份：把数据库 + 书库文件 + 封面打包为 tar.gz
#[tauri::command]
pub fn export_backup(
    app: tauri::AppHandle,
    state: tauri::State<DbState>,
    target_path: String,
) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = data_dir.join("succintreader.db");
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        checkpoint(&conn)?;
    }

    let out = File::create(&target_path).map_err(|e| format!("创建备份文件失败: {e}"))?;
    let enc = GzEncoder::new(BufWriter::new(out), Compression::default());
    let mut tar = Builder::new(enc);

    // manifest
    let mut header = tar::Header::new_gnu();
    let body = serde_json::to_string_pretty(&manifest()).unwrap();
    header.set_size(body.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    tar.append_data(&mut header, "manifest.json", body.as_bytes())
        .map_err(|e| e.to_string())?;

    // 数据库
    if db_path.exists() {
        tar.append_path_with_name(&db_path, "library.db")
            .map_err(|e| e.to_string())?;
    }

    // 书籍与封面
    let mut append_dir = |dir: &str| -> Result<(), String> {
        let src = data_dir.join(dir);
        if !src.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(&src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let p = entry.path();
            if p.is_file() {
                let name = format!("{}/{}", dir, entry.file_name().to_string_lossy());
                tar.append_path_with_name(&p, name).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    };
    append_dir("books")?;
    append_dir("covers")?;

    let enc = tar.into_inner().map_err(|e| e.to_string())?;
    enc.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn is_valid_backup(manifest_val: &serde_json::Value) -> bool {
    manifest_val.get("app").and_then(|a| a.as_str()) == Some("succintreader")
        && manifest_val.get("format_version").and_then(|v| v.as_u64()) == Some(FORMAT_VERSION as u64)
}

/// 导入备份：解包到临时目录，合并数据库，复制缺失文件
#[tauri::command]
pub fn import_backup(
    app: tauri::AppHandle,
    state: tauri::State<DbState>,
    source_path: String,
) -> Result<BackupStats, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file = File::open(&source_path).map_err(|e| format!("打开备份失败: {e}"))?;
    let dec = GzDecoder::new(BufReader::new(file));
    let mut archive = Archive::new(dec);

    let tmp = std::env::temp_dir().join(format!("sr-import-{}", Uuid::new_v4()));
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    archive.unpack(&tmp).map_err(|e| format!("解包失败: {e}"))?;

    let manifest_path = tmp.join("manifest.json");
    if !manifest_path.exists() {
        return Err("不是有效的 SuccintReader 备份包".into());
    }
    let manifest_val: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if !is_valid_backup(&manifest_val) {
        return Err("备份包格式版本不兼容".into());
    }

    // 复制文件（books / covers），已存在则跳过
    let mut files_copied = 0;
    for dir in ["books", "covers"] {
        let src_dir = tmp.join(dir);
        let dst_dir = data_dir.join(dir);
        if src_dir.exists() {
            fs::create_dir_all(&dst_dir).map_err(|e| e.to_string())?;
            for entry in fs::read_dir(&src_dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let dst = dst_dir.join(entry.file_name());
                if !dst.exists() {
                    copy(
                        &mut File::open(entry.path()).map_err(|e| e.to_string())?,
                        &mut File::create(&dst).map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string())?;
                    files_copied += 1;
                }
            }
        }
    }

    // 合并数据库
    let incoming_db = tmp.join("library.db");
    if !incoming_db.exists() {
        let _ = fs::remove_dir_all(&tmp);
        return Ok(BackupStats {
            books_imported: 0,
            skipped: 0,
            files_copied,
        });
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(&format!(
        "ATTACH DATABASE '{}' AS incoming;",
        incoming_db.to_string_lossy().replace('\'', "''")
    ))
    .map_err(|e| format!("挂载备份库失败: {e}"))?;

    let merge_books = |conn: &rusqlite::Connection| -> Result<(usize, usize), String> {
        // 已存在 id/hash 的书籍：仅当对方更新时更新阅读进度
        let incoming_books: Vec<(String, i64, i64, f64)> = {
            let mut stmt = conn
                .prepare("SELECT id, last_read_at, cur_chapter, cur_fraction FROM incoming.books")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };
        let mut imported = 0;
        let mut skipped = 0;
        for (id, last_read, ch, frac) in &incoming_books {
            let exists: Option<i64> = conn
                .query_row(
                    "SELECT last_read_at FROM books WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .ok();
            match exists {
                None => {
                    conn.execute(
                        "INSERT OR IGNORE INTO books SELECT * FROM incoming.books WHERE id = ?1",
                        params![id],
                    )
                    .map_err(|e| e.to_string())?;
                    imported += 1;
                }
                Some(local_ts) => {
                    skipped += 1;
                    if last_read > &local_ts {
                        conn.execute(
                            "UPDATE books SET cur_chapter = ?1, cur_fraction = ?2, last_read_at = ?3 WHERE id = ?4",
                            params![ch, frac, last_read, id],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
        Ok((imported, skipped))
    };

    let (books_imported, skipped) = merge_books(&conn)?;

    let copy_table = |conn: &rusqlite::Connection, table: &str, cols: &str| -> Result<(), String> {
        conn.execute(
            &format!(
                "INSERT OR IGNORE INTO {table} ({cols}) SELECT {cols} FROM incoming.{table}"
            ),
            [],
        )
        .map_err(|e| format!("合并 {table} 失败: {e}"))?;
        Ok(())
    };

    copy_table(&conn, "chapters", "book_id, idx, title, offset, volume_idx")?;
    copy_table(&conn, "volumes", "book_id, idx, title, start_chapter, end_chapter, is_custom")?;
    copy_table(&conn, "tags", "book_id, name")?;
    copy_table(&conn, "bookmarks", "id, book_id, chapter_idx, fraction, note, excerpt, created_at")?;
    copy_table(&conn, "folders", "id, name, parent_id, created_at")?;
    // 设置：保留本地，不覆盖

    conn.execute_batch("DETACH DATABASE incoming;")
        .map_err(|e| e.to_string())?;
    drop(conn);
    let _ = fs::remove_dir_all(&tmp);

    Ok(BackupStats {
        books_imported,
        skipped,
        files_copied,
    })
}

/// 供前端选取导出位置后校验路径合法性
#[tauri::command]
pub fn check_backup_file(path: String) -> Result<bool, String> {
    Ok(PathBuf::from(path).exists())
}
