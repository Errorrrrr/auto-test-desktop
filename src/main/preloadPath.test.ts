import { describe, expect, it } from 'vitest';

import { resolvePreloadPath } from './preloadPath';

describe('preload path', () => {
  it('matches the electron-vite preload output extension', () => {
    expect(resolvePreloadPath('/project/out/main')).toBe('/project/out/preload/index.mjs');
  });
});
