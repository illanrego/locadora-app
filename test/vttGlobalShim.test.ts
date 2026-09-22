import vttCueExtended from '../node_modules/vtt.js/lib/vttcue-extended.js?raw';
import vttCue from '../node_modules/vtt.js/lib/vttcue.js?raw';
import vttRegionExtended from '../node_modules/vtt.js/lib/vttregion-extended.js?raw';
import vttRegion from '../node_modules/vtt.js/lib/vttregion.js?raw';
import vtt from '../node_modules/vtt.js/lib/vtt.js?raw';

import { describe, expect, it } from 'vitest';

import { rewriteTopLevelThis } from '../tools/vttGlobalShim';

// The shim is only useful while vtt.js keeps publishing its API through a
// top-level `this`; these fixtures fail loudly if a dependency update changes
// that shape and the workaround silently becomes a no-op.
const SHIPPED_VTT_SOURCES = {
  'vtt.js': vtt,
  'vttcue.js': vttCue,
  'vttcue-extended.js': vttCueExtended,
  'vttregion.js': vttRegion,
  'vttregion-extended.js': vttRegionExtended,
};

describe('rewriteTopLevelThis', () => {
  it('hands the UMD footer the real global', () => {
    const source = '  global.WebVTT = WebVTT;\n\n}(this));\n';
    expect(rewriteTopLevelThis(source)).toBe('  global.WebVTT = WebVTT;\n\n}(globalThis));\n');
  });

  it('leaves modules that do not use the UMD footer alone', () => {
    const source = 'export const WebVTT = {};\n';
    expect(rewriteTopLevelThis(source)).toBe(source);
  });

  it('rewrites every vtt.js file that would throw on an undefined global', () => {
    for (const [file, source] of Object.entries(SHIPPED_VTT_SOURCES)) {
      expect(source, `${file} should still use the UMD footer`).toContain('}(this));');
      const rewritten = rewriteTopLevelThis(source);
      expect(rewritten, `${file} should no longer call the IIFE with undefined`).not.toContain('}(this));');
      expect(rewritten).toContain('}(globalThis));');
    }
  });
});
