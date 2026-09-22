// Ported from the MIT-licensed Locadora web modules in ../locadora/public.
// Keep these values aligned with genre-themes.js and immersive-preferences.js.
export interface ImmersiveTheme {
  backing: string;
  trim: string;
  sign: string;
  lamp: string;
}

export const IMMERSIVE_THEMES: Record<string, ImmersiveTheme> = Object.freeze({
  action: { backing: '#8a421f', trim: '#f09a3e', sign: '#3b1608', lamp: '#ffd06a' },
  comedy: { backing: '#a87913', trim: '#ffe27a', sign: '#503405', lamp: '#fff0a6' },
  horror: { backing: '#4c101b', trim: '#a92e43', sign: '#21060d', lamp: '#e86452' },
  scifi: { backing: '#49328b', trim: '#ab9cff', sign: '#21154d', lamp: '#d5ceff' },
  drama: { backing: '#1e3557', trim: '#456d9c', sign: '#0e1b33', lamp: '#b7cef2' },
  crime: { backing: '#5a1724', trim: '#bd4a61', sign: '#260811', lamp: '#f0b36b' },
  romance: { backing: '#873858', trim: '#f29ab1', sign: '#461628', lamp: '#ffd0a0' },
  family: { backing: '#2f526b', trim: '#527f9e', sign: '#101827', lamp: '#c99a2e' },
  documentary: { backing: '#4c6634', trim: '#b2c96a', sign: '#243318', lamp: '#e3d990' },
});

export const DEFAULT_IMMERSIVE_THEME = IMMERSIVE_THEMES.family;

const IMMERSIVE_KEY = 'locadora:immersive:v1:enabled';

export function readImmersiveEnabled(): boolean {
  try {
    // The 3D shelf is the intended surface; the 2D shelf stays as the accessible
    // fallback and is restored automatically when WebGL cannot start.
    return window.localStorage.getItem(IMMERSIVE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeImmersiveEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(IMMERSIVE_KEY, String(enabled));
  } catch {
    // The in-memory setting still applies to this session.
  }
}
