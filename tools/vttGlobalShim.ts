import type { Plugin } from 'vite';

/**
 * Build-time shim for the script-style files shipped by `vtt.js`, which
 * `@stremio/stremio-video` requires for HTML subtitle rendering.
 *
 * Each file ends with a UMD-style invocation that publishes its API on the
 * global object it is handed:
 *
 *   (function (global) { ... global.WebVTT = WebVTT; }(this));
 *
 * At the top level of an ES module `this` is `undefined`, and the production
 * bundler substitutes that literal, so evaluating the bundle throws
 * `Cannot set properties of undefined (setting 'WebVTT')` and the whole app
 * fails to mount (blank window). Handing the IIFE the real global keeps the
 * dependency's intended behaviour without patching node_modules on disk.
 */
const VTT_PACKAGE = /node_modules[\\/]vtt\.js[\\/]/;
const UMD_FOOTER = /^\}\(this\)\);[ \t]*$/m;

export function rewriteTopLevelThis(code: string): string {
  return code.replace(UMD_FOOTER, '}(globalThis));');
}

export function vttGlobalShim(): Plugin {
  return {
    name: 'locadora:vtt-global-shim',
    enforce: 'pre',
    transform(code, id) {
      if (!VTT_PACKAGE.test(id)) return null;
      const rewritten = rewriteTopLevelThis(code);
      if (rewritten === code) return null;
      return { code: rewritten, map: { mappings: '' } };
    },
  };
}
