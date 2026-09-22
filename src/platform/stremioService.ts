export const STREMIO_SERVICE_URL = 'http://127.0.0.1:11470/';

export async function stremioServiceAvailable(timeoutMs = 1_000): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${STREMIO_SERVICE_URL}network-info`, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}
