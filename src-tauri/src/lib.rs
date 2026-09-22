mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::native_capabilities,
            commands::fetch_addon_json,
            commands::fetch_public_shelf,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Will's Locadora Player");
}
