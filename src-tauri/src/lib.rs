pub mod backup;
pub mod book;
pub mod db;
pub mod library;

use db::DbState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("无法获取应用数据目录");
            let conn = db::init_db(&dir).expect("数据库初始化失败");
            app.manage(DbState(std::sync::Mutex::new(conn)));
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            library::import_book,
            library::list_books,
            library::search_books,
            library::update_book,
            library::delete_book,
            library::set_cover,
            library::set_progress,
            library::get_chapters,
            library::get_volumes,
            library::create_custom_volumes,
            library::replace_chapters,
            library::list_folders,
            library::create_folder,
            library::rename_folder,
            library::delete_folder,
            library::set_book_tags,
            library::list_bookmarks,
            library::add_bookmark,
            library::delete_bookmark,
            library::get_settings,
            library::save_settings,
            library::read_text,
            library::get_book_file_stat,
            backup::export_backup,
            backup::import_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
