//! libmpv requires LC_NUMERIC=C even when the desktop locale also uses a dot.
//! Configure once, before GTK/Tauri create threads; never mutate it per playback.
pub fn configure() {
    // SAFETY: called at process startup, before GTK and application worker threads.
    // Preserve the user's locale for every other category, as GTK normally does.
    unsafe {
        libc::setlocale(libc::LC_ALL, c"".as_ptr());
        assert!(!libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr()).is_null());
    }
    // Otherwise gtk_init resets LC_ALL from the environment, undoing the fix.
    gtk::disable_setlocale();
}

#[cfg(test)]
mod tests {
    use std::{
        ffi::{CStr, c_void},
        process::Command,
    };

    #[link(name = "mpv")]
    unsafe extern "C" {
        fn mpv_create() -> *mut c_void;
        fn mpv_terminate_destroy(handle: *mut c_void);
    }

    #[test]
    fn desktop_locale_allows_embedded_mpv() {
        // Isolate global libc locale changes from all other test threads.
        if std::env::var_os("LOCADORA_LOCALE_TEST_CHILD").is_none() {
            let output = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "native_locale::tests::desktop_locale_allows_embedded_mpv",
                    "--nocapture",
                ])
                .env("LOCADORA_LOCALE_TEST_CHILD", "1")
                .env("LC_ALL", "en_US.UTF-8")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }
        unsafe {
            assert!(!libc::setlocale(libc::LC_ALL, c"".as_ptr()).is_null());
            // Reproduce GTK's environment-locale setup before applying our fix.
            let before = mpv_create();
            assert!(
                before.is_null(),
                "regression fixture must reproduce mpv rejection"
            );
            super::configure();
            assert_eq!(
                CStr::from_ptr(libc::setlocale(libc::LC_NUMERIC, std::ptr::null())).to_bytes(),
                b"C"
            );
            assert_ne!(
                CStr::from_ptr(libc::setlocale(libc::LC_TIME, std::ptr::null())).to_bytes(),
                b"C"
            );
            let after = mpv_create();
            assert!(
                !after.is_null(),
                "libmpv creation must succeed with the corrected locale"
            );
            mpv_terminate_destroy(after);
        }
        let mut session = locadora_native_core::MpvSession::start(
            &locadora_native_core::player_runtime_root(),
            locadora_native_core::VideoOutput::Embedded,
        )
        .expect("initialize embedded mpv and its private control channel after locale correction");
        assert!(session.is_alive());
    }
}
