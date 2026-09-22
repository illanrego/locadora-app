import {
  controlNativePlayer,
  loadNativePlayer,
  readNativePlayerEvents,
  setNativePlayerProperty,
  shutdownNativePlayer,
  startNativePlayer,
  type NativePlayerEvent,
} from './nativeBridge';

type ShellEvent = 'mpv-prop-change' | 'mpv-event-ended' | 'mpv-event-video-ready';
type ShellListener = (value: unknown) => void;

function mpvVersion(value: string | null): string {
  return value?.match(/\d+(?:\.\d+){1,2}/)?.[0] ?? '0.0.0';
}

function nativeCommandError(value: unknown): string {
  // Native player errors are fixed, sanitized strings and never carry a URL.
  if (typeof value === 'string' && value.trim()) return value.slice(0, 200);
  return 'The native player command failed';
}

function nativePropertyValue(property: string, value: unknown): unknown {
  // Stremio's own shell asks for copy-back decoding because it renders through
  // the libmpv render API. We render through a real vo=gpu window, where
  // zero-copy interop is available. Copy-back is unavailable on some Linux
  // drivers, and mpv then falls back to software decoding, which cannot keep up
  // with real 1080p content on a weak CPU.
  if (property === 'hwdec' && value === 'auto-copy') return 'auto';
  return value;
}

export class StremioShellTransport {
  readonly capabilities = { nativeAssSubtitles: false };

  private readonly listeners = new Map<ShellEvent, Set<ShellListener>>();
  private queue: Promise<void> = Promise.resolve();
  private pollTimer: number | null = null;
  private loadId = 0;
  private activeLoadId = 0;
  private destroyed = false;

  constructor(private readonly reportedMpvVersion: string | null) {}

  async start(): Promise<void> {
    await startNativePlayer();
    if (this.pollTimer === null) {
      this.pollTimer = window.setInterval(() => void this.poll(), 250);
    }
  }

  on(event: ShellEvent, listener: ShellListener): void {
    const listeners = this.listeners.get(event) ?? new Set<ShellListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: ShellEvent, listener: ShellListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  send(name: string, args: unknown): void {
    if (this.destroyed) return;
    const task = () =>
      this.handleSend(name, args).catch((error: unknown) => this.reportFailure(name, args, error));
    this.queue = this.queue.then(task, task);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
    await this.queue.catch(() => undefined);
    await shutdownNativePlayer();
    this.listeners.clear();
  }

  private emit(event: ShellEvent, value: unknown): void {
    this.listeners.get(event)?.forEach((listener) => listener(value));
  }

  private async handleSend(name: string, args: unknown): Promise<void> {
    if (name === 'mpv-observe-prop' && typeof args === 'string') {
      if (args === 'mpv-version') {
        this.emit('mpv-prop-change', { name: args, data: mpvVersion(this.reportedMpvVersion) });
      } else if (args === 'ffmpeg-version') {
        this.emit('mpv-prop-change', { name: args, data: 'system' });
      }
      return;
    }

    if (name === 'mpv-command' && Array.isArray(args)) {
      const [command, value] = args;
      if (command === 'stop') {
        await controlNativePlayer('stop');
        return;
      }
      if (command === 'loadfile' && typeof value === 'string') {
        this.activeLoadId = ++this.loadId;
        this.emit('mpv-event-video-ready', { loadId: this.activeLoadId, ready: false });
        await loadNativePlayer(value);
      }
      return;
    }

    if (name === 'mpv-set-prop' && Array.isArray(args)) {
      const [property, rawValue] = args;
      if (typeof property !== 'string' || property === 'vo') return;
      const value = ['mute', 'input-default-bindings', 'input-vo-keyboard'].includes(property)
        && (rawValue === 'yes' || rawValue === 'no')
        ? rawValue === 'yes'
        : rawValue;
      await setNativePlayerProperty(property, nativePropertyValue(property, value));
    }
  }

  /**
   * Only a rejected load means the stream cannot play. A rejected cosmetic
   * property (subtitle size, aspect, volume) or an already-stopped session must
   * not be reported as a playback failure.
   */
  private reportFailure(name: string, args: unknown, error: unknown): void {
    const isLoad = name === 'mpv-command' && Array.isArray(args) && args[0] === 'loadfile';
    if (!isLoad) return;
    this.emit('mpv-event-ended', { error: nativeCommandError(error) });
  }

  private async poll(): Promise<void> {
    if (this.destroyed) return;
    try {
      const events = await readNativePlayerEvents();
      events.forEach((event) => this.forwardPlayerEvent(event));
    } catch {
      this.emit('mpv-event-ended', { error: 'The native player event channel failed' });
    }
  }

  private forwardPlayerEvent(event: NativePlayerEvent): void {
    switch (event.kind) {
      case 'file-loaded':
        this.emit('mpv-event-video-ready', { loadId: this.activeLoadId, ready: true });
        break;
      case 'playing':
        this.emit('mpv-prop-change', { name: 'pause', data: false });
        this.emit('mpv-prop-change', { name: 'paused-for-cache', data: false });
        break;
      case 'paused':
        this.emit('mpv-prop-change', { name: 'pause', data: true });
        break;
      case 'position':
        this.emit('mpv-prop-change', { name: 'time-pos', data: event.value });
        break;
      case 'duration':
        this.emit('mpv-prop-change', { name: 'duration', data: event.value });
        break;
      case 'property':
        this.emit('mpv-prop-change', event.value);
        break;
      case 'ended':
        this.emit('mpv-event-ended', { reason: event.value });
        break;
      case 'failed':
        this.emit('mpv-event-ended', { error: event.value });
        break;
      default:
        break;
    }
  }
}
