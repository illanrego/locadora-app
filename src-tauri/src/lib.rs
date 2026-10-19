mod commands;
mod embedded_surface;
mod native_locale;
mod streaming_engine;
mod tape_download;
mod tape_store;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    native_locale::configure();
    tauri::Builder::default()
        .manage(commands::PlayerState::default())
        .manage(streaming_engine::EngineState::default())
        .manage(tape_download::DownloadState::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                embedded_surface::install(&window).map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::native_capabilities,
            streaming_engine::streaming_engine_ensure,
            streaming_engine::streaming_engine_status,
            streaming_engine::streaming_engine_request,
            streaming_engine::tape_engine_ensure,
            streaming_engine::tape_engine_status,
            streaming_engine::tape_engine_request,
            tape_download::tape_download_start,
            tape_download::tape_download_cancel,
            tape_store::tape_store_read,
            tape_store::tape_store_write,
            tape_store::tape_store_clear,
            commands::fetch_public_shelf,
            commands::fetch_public_title,
            commands::fetch_public_search,
            commands::fetch_public_person_search,
            commands::fetch_public_person,
            commands::fetch_public_credit_stand,
            commands::fetch_public_artwork,
            commands::member_session_status,
            commands::member_sign_in,
            commands::member_sign_up,
            commands::member_update_profile,
            commands::member_update_rental_limit,
            commands::member_update_collection,
            commands::member_create_rental,
            commands::member_return_rental,
            commands::member_history,
            commands::title_reviews,
            commands::member_review_eligibility,
            commands::member_write_review,
            commands::member_sign_out,
            commands::member_state,
            commands::media_configuration_status,
            commands::media_configuration_import_stremio,
            commands::media_configuration_add,
            commands::fetch_configured_addon_resource,
            commands::media_configuration_remove,
            commands::media_configuration_disconnect,
            commands::player_start,
            commands::player_set_bounds,
            commands::player_fullscreen,
            commands::player_load,
            commands::player_control,
            commands::player_mark,
            commands::player_set_property,
            commands::player_select_subtitle,
            commands::player_events,
            commands::player_shutdown,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Will's Locadora Player")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<tape_download::DownloadState>().cancel();
                app.state::<streaming_engine::EngineState>().shutdown();
            }
        });
}
