//! Minimal ownership wrapper around the installed libmpv client/render ABI.
//! RenderContext stays on its creating GL thread; ordinary controls use IPC.
use crate::PlayerError;
use std::{
    ffi::{CString, c_char, c_int, c_void},
    marker::PhantomData,
    path::Path,
    ptr,
    rc::Rc,
    sync::Arc,
};

#[repr(C)]
struct Param {
    kind: c_int,
    data: *mut c_void,
}
#[repr(C)]
struct GlInit {
    get_proc: unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void,
    context: *mut c_void,
}
#[repr(C)]
struct Fbo {
    id: c_int,
    width: c_int,
    height: c_int,
    format: c_int,
}

#[link(name = "mpv")]
unsafe extern "C" {
    fn mpv_create() -> *mut c_void;
    fn mpv_set_option_string(
        handle: *mut c_void,
        name: *const c_char,
        value: *const c_char,
    ) -> c_int;
    fn mpv_initialize(handle: *mut c_void) -> c_int;
    fn mpv_terminate_destroy(handle: *mut c_void);
    fn mpv_render_context_create(
        context: *mut *mut c_void,
        handle: *mut c_void,
        params: *mut Param,
    ) -> c_int;
    fn mpv_render_context_render(context: *mut c_void, params: *mut Param) -> c_int;
    fn mpv_render_context_update(context: *mut c_void) -> u64;
    fn mpv_render_context_free(context: *mut c_void);
}

pub struct EmbeddedMpv(*mut c_void);
// mpv's client handle is thread safe; the render handle below is deliberately not.
unsafe impl Send for EmbeddedMpv {}
unsafe impl Sync for EmbeddedMpv {}

impl EmbeddedMpv {
    pub(crate) fn new(socket: &Path) -> Result<Arc<Self>, PlayerError> {
        let handle = unsafe { mpv_create() };
        if handle.is_null() {
            return Err(PlayerError::Unavailable);
        }
        let owner = Arc::new(Self(handle));
        let socket = socket.to_str().ok_or(PlayerError::ControlUnavailable)?;
        for (name, value) in [
            ("config", "no"),
            ("terminal", "no"),
            ("msg-level", "all=no"),
            ("idle", "yes"),
            ("vo", "libmpv"),
            ("force-window", "no"),
            ("osc", "no"),
            ("input-default-bindings", "no"),
            ("input-vo-keyboard", "no"),
            ("hwdec", "auto"),
            ("cache", "yes"),
            ("cache-pause", "yes"),
            ("cache-pause-initial", "yes"),
            ("cache-pause-wait", "5"),
            ("demuxer-readahead-secs", "60"),
            ("demuxer-max-bytes", "134217728"),
            ("demuxer-max-back-bytes", "33554432"),
            ("input-ipc-server", socket),
        ] {
            let name = CString::new(name).map_err(|_| PlayerError::CommandFailed)?;
            let value = CString::new(value).map_err(|_| PlayerError::CommandFailed)?;
            if unsafe { mpv_set_option_string(handle, name.as_ptr(), value.as_ptr()) } < 0 {
                return Err(PlayerError::CommandFailed);
            }
        }
        if unsafe { mpv_initialize(handle) } < 0 {
            return Err(PlayerError::Unavailable);
        }
        Ok(owner)
    }
}

impl Drop for EmbeddedMpv {
    fn drop(&mut self) {
        unsafe {
            mpv_terminate_destroy(self.0);
        }
    }
}

pub struct MpvRenderContext {
    context: *mut c_void,
    _owner: Arc<EmbeddedMpv>,
    _gl_thread: PhantomData<Rc<()>>,
}

impl MpvRenderContext {
    /// # Safety
    /// A compatible GL context must be current on this thread for creation,
    /// rendering, update and drop. `get_proc` must resolve that context's API.
    pub unsafe fn new(
        owner: Arc<EmbeddedMpv>,
        get_proc: unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void,
    ) -> Result<Self, PlayerError> {
        let mut init = GlInit {
            get_proc,
            context: ptr::null_mut(),
        };
        let mut params = [
            Param {
                kind: 1,
                data: c"opengl".as_ptr().cast_mut().cast(),
            },
            Param {
                kind: 2,
                data: (&mut init as *mut GlInit).cast(),
            },
            Param {
                kind: 0,
                data: ptr::null_mut(),
            },
        ];
        let mut context = ptr::null_mut();
        if unsafe { mpv_render_context_create(&mut context, owner.0, params.as_mut_ptr()) } < 0 {
            return Err(PlayerError::Unavailable);
        }
        Ok(Self {
            context,
            _owner: owner,
            _gl_thread: PhantomData,
        })
    }

    pub fn update(&mut self) -> bool {
        unsafe { mpv_render_context_update(self.context) & 1 != 0 }
    }

    pub fn render(&mut self, framebuffer: i32, width: i32, height: i32) -> Result<(), PlayerError> {
        let mut fbo = Fbo {
            id: framebuffer,
            width,
            height,
            format: 0,
        };
        let mut flip = 1_i32;
        let mut block = 0_i32;
        let mut params = [
            Param {
                kind: 3,
                data: (&mut fbo as *mut Fbo).cast(),
            },
            Param {
                kind: 4,
                data: (&mut flip as *mut i32).cast(),
            },
            // GTK's frame clock controls presentation; never block its UI thread.
            Param {
                kind: 12,
                data: (&mut block as *mut i32).cast(),
            },
            Param {
                kind: 0,
                data: ptr::null_mut(),
            },
        ];
        if unsafe { mpv_render_context_render(self.context, params.as_mut_ptr()) } < 0 {
            return Err(PlayerError::CommandFailed);
        }
        Ok(())
    }
}

impl Drop for MpvRenderContext {
    fn drop(&mut self) {
        unsafe {
            mpv_render_context_free(self.context);
        }
    }
}
