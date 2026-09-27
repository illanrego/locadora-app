//! GTK objects and libmpv GL rendering live exclusively on the main thread.
use glib::translate::{IntoGlib, ToGlibPtr};
use gtk::{gdk, glib, prelude::*};
use locadora_native_core::{MpvRenderContext, MpvSession, VideoOutput, player_runtime_root};
use serde::Deserialize;
use std::{
    cell::RefCell,
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
}

struct Surface {
    overlay: gtk::Overlay,
    area: gtk::GLArea,
    renderer: Rc<RefCell<Option<MpvRenderContext>>>,
    bounds: VideoBounds,
    fullscreen: bool,
}

thread_local! { static SURFACE: RefCell<Option<Surface>> = const { RefCell::new(None) }; }

fn detach_tauri_resize_handler(widget: &gtk::Widget) {
    // Tauri attaches this handler to every Linux WebView and assumes the
    // WebView's grandparent is the GtkWindow. Embedding the GLArea introduces
    // a GtkOverlay at that position, so the upstream handler panics while
    // downcasting it on any click. This window uses GTK decorations, therefore
    // the handler never provides resizing behavior and is safe to remove.
    let signal_name = c"button-press-event";
    let signal_id = unsafe {
        glib::gobject_ffi::g_signal_lookup(signal_name.as_ptr(), widget.type_().into_glib())
    };
    if signal_id == 0 {
        return;
    }
    let widget_ptr: *mut gtk::ffi::GtkWidget = widget.to_glib_none().0;
    unsafe {
        glib::gobject_ffi::g_signal_handlers_disconnect_matched(
            widget_ptr.cast(),
            glib::gobject_ffi::G_SIGNAL_MATCH_ID,
            signal_id,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        );
    }
}

impl Surface {
    fn layout(&self) {
        let margins = if self.fullscreen {
            [0; 4]
        } else {
            self.bounds.margins(
                self.overlay.allocated_width().max(1),
                self.overlay.allocated_height().max(1),
            )
        };
        self.area.set_margin_start(margins[0]);
        self.area.set_margin_top(margins[1]);
        self.area.set_margin_end(margins[2]);
        self.area.set_margin_bottom(margins[3]);
        self.overlay
            .set_overlay_pass_through(&self.area, !self.fullscreen);
        self.area.set_visible(
            self.renderer.borrow().is_some() && (self.fullscreen || self.bounds.visible),
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
        detach_tauri_resize_handler(&child);
        vbox.remove(&child);
        content.pack_start(&child, true, true, 0);
    }
    let overlay = gtk::Overlay::new();
    overlay.add(&content);
    let area = gtk::GLArea::new();
    area.set_required_version(3, 2);
    area.set_has_alpha(false);
    area.set_auto_render(false);
    area.set_can_focus(false);
    area.set_hexpand(true);
    area.set_vexpand(true);
    area.set_no_show_all(true);
    overlay.add_overlay(&area);
    // Mouse and keyboard input stay with the React surface and its controls.
    overlay.set_overlay_pass_through(&area, true);
    vbox.pack_start(&overlay, true, true, 0);
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
            fullscreen: false,
        })
    });
    Ok(())
}

pub fn start() -> Result<MpvSession, String> {
    SURFACE.with(|surface| {
        let surface = surface.borrow();
        let surface = surface
            .as_ref()
            .ok_or("Embedded video surface is unavailable")?;
        let session = MpvSession::start(&player_runtime_root(), VideoOutput::Embedded)
            .map_err(|_| "Could not initialize embedded mpv")?;
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
            surface.layout();
        }
    });
}

pub fn release() {
    SURFACE.with(|surface| {
        if let Some(surface) = surface.borrow_mut().as_mut() {
            surface.release();
            surface.fullscreen = false;
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
        };
        assert_eq!(bounds.margins(2000, 1200), [200, 100, 600, 500]);
        assert!(bounds.validate().is_ok());
        bounds.x = f64::NAN;
        assert!(bounds.validate().is_err());
    }
}
