// Shared by embedded playback and the child-player diagnostic path.
// Seconds are a target: EOF and the byte ceiling can end filling earlier.
// Let mpv own cache pauses so a user pause is never undone by a UI timer.
// Deliberately biased towards weak connections: a good connection plays fine
// with a deep reserve, a bad one fails without it. The resume target is the
// middle term - short enough that a starving source stumbles for a few seconds
// instead of freezing for a quarter of a minute, deep enough to still ride out
// a dip. Backward cache is doubled so stepping back replays from memory instead
// of asking the swarm again.
pub(crate) const OPTIONS: &[(&str, &str)] = &[
    ("cache", "yes"),
    ("cache-pause", "yes"),
    ("cache-pause-initial", "yes"),
    ("cache-pause-wait", "8"),
    ("cache-secs", "120"),
    ("demuxer-readahead-secs", "120"),
    ("demuxer-max-bytes", "268435456"),
    ("demuxer-max-back-bytes", "67108864"),
];
