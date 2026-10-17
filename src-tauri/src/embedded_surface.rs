//! GTK objects and libmpv GL rendering live exclusively on the main thread.
use gtk::{gdk, glib, prelude::*};
use locadora_native_core::{MpvRenderContext, MpvSession, VideoOutput, player_runtime_root};
use serde::Deserialize;
use std::{
    cell::{Cell, RefCell},
    ffi::{c_char, c_void},
    rc::Rc,
};
use tauri::{Emitter, WebviewWindow};

#[link(name = "epoxy")]
unsafe extern "C" {
    static epoxy_glGetIntegerv: unsafe extern "C" fn(u32, *mut i32);
    static epoxy_glXGetProcAddressARB: unsafe extern "C" fn(*const u8) -> *mut c_void;
    static epoxy_eglGetProcAddress: unsafe extern "C" fn(*const c_char) -> *mut c_void;
}

unsafe extern "C" fn glx_proc(_: *mut c_void, name: *const c_char) -> *mut c_void {
    unsafe { epoxy_glXGetProcAddressARB(name.cast()) }
}
unsafe extern "C" fn egl_proc(_: *mut c_void, name: *const c_char) -> *mut c_void {
    unsafe { epoxy_eglGetProcAddress(name) }
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    viewport_height: f64,
    visible: bool,
    fullscreen: bool,
}

impl VideoBounds {
    pub fn validate(&self) -> Result<(), String> {
        if [
            self.x,
            self.y,
            self.width,
            self.height,
            self.viewport_width,
            self.viewport_height,
        ]
        .iter()
        .any(|n| !n.is_finite() || *n < 0.0 || *n > 32768.0)
            || (self.visible && (self.viewport_width < 1.0 || self.viewport_height < 1.0))
        {
            return Err("Invalid video surface bounds".into());
        }
        Ok(())
    }

    fn margins(&self, width: i32, height: i32) -> [i32; 4] {
        let scale_x = f64::from(width) / self.viewport_width.max(1.0);
        let scale_y = f64::from(height) / self.viewport_height.max(1.0);
        let left = (self.x * scale_x).round().clamp(0.0, f64::from(width)) as i32;
        let top = (self.y * scale_y).round().clamp(0.0, f64::from(height)) as i32;
        let right = (f64::from(width) - (self.x + self.width) * scale_x)
            .round()
            .clamp(0.0, f64::from(width - left)) as i32;
        let bottom = (f64::from(height) - (self.y + self.height) * scale_y)
            .round()
            .clamp(0.0, f64::from(height - top)) as i32;
        [left, top, right, bottom]
    }

    fn presentation_margins(&self, width: i32, height: i32, fullscreen: bool) -> Option<[i32; 4]> {
        if fullscreen {
            // Native window state owns fullscreen dimensions, even while the
            // WebView is still reporting its previous windowed layout.
            Some([0; 4])
        } else if self.fullscreen {
            // Never stretch a fullscreen report into the restored window.
            // Wait for its new windowed frame instead of cropping the movie.
            None
        } else {
            Some(self.margins(width, height))
        }
    }
}

struct Surface {
    overlay: gtk::Overlay,
    area: gtk::GLArea,
    renderer: Rc<RefCell<Option<MpvRenderContext>>>,
    bounds: VideoBounds,
    last_real_bounds: Option<VideoBounds>,
    requested_visible: Cell<bool>,
    fullscreen: bool,
}

thread_local! { static SURFACE: RefCell<Option<Surface>> = const { RefCell::new(None) }; }

impl Surface {
    /// The rectangle the surface should occupy. A live session keeps the last
    /// real rectangle: a layout pass can report the WebView surface as
    /// zero-sized for a frame, and hiding the video on that measurement left
    /// windowed playback black until the user entered fullscreen.
    fn usable_bounds(&self) -> Option<VideoBounds> {
        if self.bounds.width >= 1.0 && self.bounds.height >= 1.0 {
            Some(self.bounds)
        } else {
            self.last_real_bounds
        }
    }

    fn layout(&self) {
        let usable = self.usable_bounds();
        let margins = if let Some(bounds) = usable {
            bounds.presentation_margins(
                self.overlay.allocated_width().max(1),
                self.overlay.allocated_height().max(1),
                self.fullscreen,
            )
        } else {
            None
        };
        let Some(margins) = margins else {
            self.area.hide();
            return;
        };
        self.area.set_margin_start(margins[0]);
        self.area.set_margin_top(margins[1]);
        self.area.set_margin_end(margins[2]);
        self.area.set_margin_bottom(margins[3]);
        self.overlay.set_overlay_pass_through(&self.area, true);
        self.area.set_visible(
            self.renderer.borrow().is_some() && usable.is_some() && self.requested_visible.get(),
        );
    }

    fn release(&self) {
        if self.renderer.borrow().is_some() {
            self.area.make_current();
            self.renderer.borrow_mut().take();
        }
        self.area.hide();
    }
}

pub fn install(window: &WebviewWindow) -> Result<(), String> {
    let vbox = window
        .default_vbox()
        .map_err(|_| "Native layout is unavailable")?;
    let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
    for child in vbox.children() {
        vbox.remove(&child);
        content.pack_start(&child, true, true, 0);
    }
    let overlay = gtk::Overlay::new();
    // Keep an opaque black native base, then video, then a transparent WebView.
    // The WebView must be last so menus always paint above native playback.
    let background = gtk::DrawingArea::new();
    background.connect_draw(|_, context| {
        context.set_source_rgb(0.0, 0.0, 0.0);
        let _ = context.paint();
        glib::Propagation::Stop
    });
    overlay.add(&background);
    let area = gtk::GLArea::new();
    area.set_required_version(3, 2);
    area.set_has_alpha(false);
    area.set_auto_render(false);
    // With auto-render disabled, paused/buffering playback has no new mpv
    // frames to trigger a redraw after fullscreen or panel resizing.
    area.connect_resize(|area, _, _| area.queue_render());
    area.set_can_focus(false);
    area.set_hexpand(true);
    area.set_vexpand(true);
    area.set_no_show_all(true);
    overlay.add_overlay(&area);
    overlay.set_overlay_pass_through(&area, true);
    content.set_halign(gtk::Align::Fill);
    content.set_valign(gtk::Align::Fill);
    overlay.add_overlay(&content);
    overlay.set_overlay_pass_through(&content, false);
    let webview: &tauri::Webview = window.as_ref();
    webview
        .set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)))
        .map_err(|_| "Could not prepare player composition")?;
    vbox.pack_start(&overlay, true, true, 0);
    background.show();
    content.show_all();
    overlay.show();

    let renderer: Rc<RefCell<Option<MpvRenderContext>>> = Rc::new(RefCell::new(None));
    let draw_renderer = renderer.clone();
    let error_window = window.clone();
    area.connect_render(move |area, _| {
        if let Some(renderer) = draw_renderer.borrow_mut().as_mut() {
            let mut framebuffer = 0;
            unsafe {
                epoxy_glGetIntegerv(0x8CA6, &mut framebuffer);
            }
            let scale = area.scale_factor();
            if renderer
                .render(
                    framebuffer,
                    area.allocated_width() * scale,
                    area.allocated_height() * scale,
                )
                .is_err()
            {
                let _ =
                    error_window.emit("player-render-error", "The embedded video renderer failed");
            }
        }
        glib::Propagation::Stop
    });
    let frame_renderer = renderer.clone();
    area.add_tick_callback(move |area, _| {
        if area.is_visible() {
            area.make_current();
            if let Some(renderer) = frame_renderer.borrow_mut().as_mut()
                && renderer.update()
            {
                area.queue_render();
            }
        }
        glib::ControlFlow::Continue
    });
    let release_renderer = renderer.clone();
    area.connect_unrealize(move |area| {
        area.make_current();
        release_renderer.borrow_mut().take();
    });
    overlay.connect_size_allocate(|_, _| {
        SURFACE.with(|surface| {
            if let Ok(surface) = surface.try_borrow()
                && let Some(surface) = surface.as_ref()
            {
                surface.layout();
            }
        });
    });
    let gtk_window = window
        .gtk_window()
        .map_err(|_| "Native window is unavailable")?;
    let event_window = window.clone();
    gtk_window.connect_window_state_event(move |_, event| {
        let fullscreen = event
            .new_window_state()
            .contains(gdk::WindowState::FULLSCREEN);
        SURFACE.with(|surface| {
            if let Some(surface) = surface.borrow_mut().as_mut() {
                surface.fullscreen = fullscreen;
                surface.layout();
            }
        });
        let _ = event_window.emit("player-fullscreen-changed", fullscreen);
        glib::Propagation::Proceed
    });
    gtk_window.connect_delete_event(|_, _| {
        release();
        glib::Propagation::Proceed
    });
    gtk_window.connect_key_press_event(|window, event| {
        let should_exit = event.keyval() == gdk::keys::constants::Escape
            && SURFACE.with(|surface| {
                surface
                    .borrow()
                    .as_ref()
                    .is_some_and(|surface| surface.fullscreen)
            });
        if should_exit {
            window.unfullscreen();
            glib::Propagation::Stop
        } else {
            glib::Propagation::Proceed
        }
    });
    SURFACE.with(|surface| {
        *surface.borrow_mut() = Some(Surface {
            overlay,
            area,
            renderer,
            bounds: VideoBounds::default(),
            last_real_bounds: None,
            requested_visible: Cell::new(false),
            fullscreen: false,
        })
    });
    Ok(())
}

pub fn start(cache_dir: Option<&std::path::Path>) -> Result<MpvSession, String> {
    SURFACE.with(|surface| {
        let surface = surface.borrow();
        let surface = surface
            .as_ref()
            .ok_or("Embedded video surface is unavailable")?;
        let session = MpvSession::start_with_diagnostics(
            &player_runtime_root(),
            VideoOutput::Embedded,
            cache_dir,
        )
        .map_err(|error| format!("Could not initialize embedded mpv: {error}"))?;
        surface.area.show();
        surface.area.realize();
        surface.area.make_current();
        if surface.area.error().is_some() {
            surface.area.hide();
            return Err("OpenGL is unavailable for embedded playback".into());
        }
        let wayland = surface.area.display().type_().name().contains("Wayland");
        let renderer = match unsafe {
            MpvRenderContext::new(
                session.embedded_handle().ok_or("Missing mpv handle")?,
                if wayland { egl_proc } else { glx_proc },
            )
        } {
            Ok(renderer) => renderer,
            Err(_) => {
                surface.area.hide();
                return Err("Could not initialize the embedded video renderer".into());
            }
        };
        *surface.renderer.borrow_mut() = Some(renderer);
        surface.layout();
        surface.area.queue_render();
        Ok(session)
    })
}

pub fn set_bounds(bounds: VideoBounds) {
    SURFACE.with(|surface| {
        if let Some(surface) = surface.borrow_mut().as_mut() {
            surface.bounds = bounds;
            // Retain geometry through transient empty measurements, but always
            // honor explicit visibility so unload/cleanup can hide the surface.
            if bounds.width >= 1.0 && bounds.height >= 1.0 {
                surface.last_real_bounds = Some(bounds);
            }
            surface.requested_visible.set(bounds.visible);
            surface.layout();
        }
    });
}

pub fn release() {
    SURFACE.with(|surface| {
        if let Some(surface) = surface.borrow_mut().as_mut() {
            surface.release();
            // Renderer replacement does not change the window manager state.
            // Keep Escape working until the actual window-state event arrives.
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_scale_with_the_webview_and_reject_nonfinite_input() {
        let mut bounds = VideoBounds {
            x: 100.0,
            y: 50.0,
            width: 600.0,
            height: 300.0,
            viewport_width: 1000.0,
            viewport_height: 600.0,
            visible: true,
            fullscreen: false,
        };
        assert_eq!(bounds.margins(2000, 1200), [200, 100, 600, 500]);
        assert!(bounds.validate().is_ok());
        bounds.x = f64::NAN;
        assert!(bounds.validate().is_err());
    }

    #[test]
    fn fullscreen_transitions_do_not_reuse_geometry_from_the_other_mode() {
        let mut bounds = VideoBounds {
            x: 0.0,
            y: 60.0,
            width: 960.0,
            height: 620.0,
            viewport_width: 1280.0,
            viewport_height: 800.0,
            visible: true,
            fullscreen: false,
        };
        // Entering fullscreen ignores the old header, dock and source drawer.
        assert_eq!(bounds.presentation_margins(1920, 1080, true), Some([0; 4]));
        bounds.fullscreen = true;
        assert_eq!(bounds.presentation_margins(1920, 1080, true), Some([0; 4]));
        // Exiting must not squeeze the fullscreen movie under restored chrome.
        assert_eq!(bounds.presentation_margins(1280, 800, false), None);
        bounds.fullscreen = false;
        assert_eq!(
            bounds.presentation_margins(1280, 800, false),
            Some([0, 60, 320, 120])
        );
        // Another enter/exit cycle uses the same rules, including HiDPI sizing.
        assert_eq!(bounds.presentation_margins(3840, 2160, true), Some([0; 4]));
        assert_eq!(
            bounds.presentation_margins(2560, 1600, false),
            Some([0, 120, 640, 240])
        );
    }

    #[test]
    fn vendored_tauri_resize_handlers_do_not_panic_after_reparenting() {
        let source = include_str!("../vendor/tauri-runtime-wry-2.11.4/src/undecorated_resizing.rs");
        assert_eq!(
            source
                .matches("let Ok(window) = window.downcast::<gtk::Window>()")
                .count(),
            2,
            "both pointer and touch handlers must use fallible GTK downcasts"
        );
        assert!(!source.contains("let window: gtk::Window = window.downcast().unwrap()"));
    }
}
