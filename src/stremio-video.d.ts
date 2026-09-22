declare module '@stremio/stremio-video' {
  export default class StremioVideo {
    static ERROR: Record<string, unknown>;
    on(eventName: string, listener: (...args: unknown[]) => void): void;
    dispatch(action: Record<string, unknown>, options?: Record<string, unknown>): void;
    destroy(): void;
  }
}
