//! Native shell for Open-BIM. Heavy native work (large-file IO, IFC, geometry offload)
//! will live here as Tauri commands.

mod cad;

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![app_version, cad::dwg_to_dxf, cad::dxf_to_dwg, cad::dwg_converter])
        .run(tauri::generate_context!())
        .expect("error while running Open-BIM");
}
