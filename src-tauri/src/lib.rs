mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::PlayerState::default())
        .invoke_handler(tauri::generate_handler![
            commands::native_capabilities,
            commands::fetch_public_shelf,
            commands::member_session_status,
            commands::member_sign_in,
            commands::member_sign_out,
            commands::member_state,
            commands::media_configuration_status,
            commands::media_configuration_add,
            commands::fetch_configured_addon_resource,
            commands::media_configuration_remove,
            commands::media_configuration_disconnect,
            commands::player_start,
            commands::player_load,
            commands::player_control,
            commands::player_set_property,
            commands::player_events,
            commands::player_shutdown,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Will's Locadora Player");
}
