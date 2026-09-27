# Locadora Linux reparenting patch

Upstream package: `tauri-runtime-wry` 2.11.4 from crates.io.

Locadora wraps Tauri's WebView in a `GtkOverlay` to render libmpv in the same
window. Version 2.11.4's Linux undecorated-resize mouse and touch callbacks
assume a fixed `WebView -> GtkBox -> GtkWindow` ancestry and unwrap the final
downcast. After reparenting, that object is the overlay, so any left click
panics across GTK's C callback boundary and aborts the process.

The local patch changes only those two downcasts in
`src/undecorated_resizing.rs`. A failed downcast returns
`Propagation::Proceed`, matching the safe behavior in Tauri's development
source. Do not replace this directory with the registry release until the
upstream fix is present in the resolved version and the native click test has
passed.

Upstream report: https://github.com/tauri-apps/wry/issues/1808
