// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { connectAddonForPlatform } from '../src/media/addonService';

describe('platform add-on service', () => {
  it('uses the bounded browser protocol client outside the native shell', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      id: 'org.example.fixture',
      name: 'Fixture',
      version: '1.0.0',
      types: ['movie'],
      resources: ['stream'],
    }));
    const connection = await connectAddonForPlatform('https://addon.example.invalid/manifest.json', {
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(connection.manifest.id).toBe('org.example.fixture');
  });
});
