# Constant-offset subtitle sync — feasibility, 2026-09-26

Decision: feasible enough for a measured prototype; not implemented or enabled.
The user requested assessment before implementation. This does not change the
plan's exclusion of automatic synchronization from the current release.

## Approach

Compare a binary timeline of audible speech with a binary timeline of subtitle
cues. Search for the single time shift that best aligns them. This does not
need speech transcription or translation, so English audio and Portuguese
subtitles can still be compared. An AI voice activity detector is optional.

[FFsubsync](https://github.com/smacke/ffsubsync) already implements language-
independent alignment, audio/reference-subtitle inputs, remote references and
bounded-duration sampling. Its documented `--no-fix-framerate` option limits
the job to the requested offset problem. It is MIT licensed. Use it as an
offline prototype/reference before deciding on production packaging.

[Silero VAD](https://github.com/snakers4/silero-vad) is a candidate local speech
detector with an ONNX option and MIT licensing. Its upstream performance claims
are not measurements on this machine. A smaller WebRTC VAD baseline should be
compared before adding an inference runtime.

## Proposed Locadora behavior (not implemented)

- A “Sync automatically” action analyzes a dialogue-rich sample of the selected
  audio track and the currently selected text subtitle. Initial experiment:
  90–180 seconds of audio, search within ±30 seconds; these are trial settings.
- Require a distinct correlation peak and agreement across two sample windows.
  Silence, music, overlapping speech, dubbing or sparse/condensed subtitles may
  be ambiguous. Leave the current delay intact when confidence is low.
- Apply one signed offset through the existing delay control, show the amount,
  and offer Undo. Store it against the actual video/file and subtitle identity.
- Never claim to repair drift, missing scenes, alternate edits or wrong tracks.
  Those need a different model than shifting every cue by the same amount.

## Integration work and constraints

`ffmpeg` is installed here. The current native player does not expose decoded
audio or parsed subtitle cues. External subtitle bytes now pass through native
storage, giving one useful integration point. Embedded bitmap subtitles would
remain unsupported initially; embedded text needs a bounded extraction path.

Opening a second remote reader may compete with playback and trigger torrent
seeks. Prefer already available audio or a cancellable sequential sample;
pause analysis during rebuffering. Keep audio local and short lived. Do not
pass private stream URLs in process arguments or logs; use a protected native
input/pipe boundary. No audio/model download or analysis was run in this review.

## Prototype acceptance before shipping

Use a licensed local dialogue fixture and synthetic ±0.5/2/5/15-second shifts.
Target ≤250 ms error on constant shifts, refuse silence/wrong-cut cases, verify
sign and Undo, then benchmark CPU/time and playback contention on this machine.
Repeat with translated subtitles and the selected dubbed/original audio track.
Measure before promising latency or accuracy. A working automatic feature is
not implied by this feasibility assessment.
