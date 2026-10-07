// Shared by embedded playback and the child-player diagnostic path.
// Seconds are a target: EOF and the byte ceiling can end filling earlier.
// Let mpv own cache pauses so a user pause is never undone by a UI timer.
pub(crate) const OPTIONS: &[(&str, &str)] = &[
    ("cache", "yes"),
    ("cache-pause", "yes"),
    ("cache-pause-initial", "yes"),
    ("cache-pause-wait", "15"),
    ("cache-secs", "120"),
    ("demuxer-readahead-secs", "120"),
    ("demuxer-max-bytes", "268435456"),
    ("demuxer-max-back-bytes", "33554432"),
];
