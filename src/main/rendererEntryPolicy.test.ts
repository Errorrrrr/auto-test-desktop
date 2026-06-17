import { describe, expect, it } from 'vitest';

import { resolveRendererEntry } from './rendererEntryPolicy';

describe('renderer entry policy', () => {
  it('allows local development renderer URLs only in unpackaged builds', () => {
    expect(
      resolveRendererEntry({
        isPackaged: false,
        rendererUrl: 'http://127.0.0.1:5174'
      })
    ).toEqual({
      kind: 'url',
      url: 'http://127.0.0.1:5174/'
    });

    expect(
      resolveRendererEntry({
        isPackaged: false,
        rendererUrl: 'http://localhost:5173/'
      })
    ).toEqual({
      kind: 'url',
      url: 'http://localhost:5173/'
    });
  });

  it('rejects non-local renderer URLs and falls back to the bundled renderer', () => {
    expect(
      resolveRendererEntry({
        isPackaged: false,
        rendererUrl: 'https://example.com/app'
      })
    ).toEqual({
      kind: 'file',
      reason: 'ELECTRON_RENDERER_URL must point to a local development server.'
    });
  });

  it('forces packaged builds to load the bundled renderer', () => {
    expect(
      resolveRendererEntry({
        isPackaged: true,
        rendererUrl: 'http://127.0.0.1:5174'
      })
    ).toEqual({
      kind: 'file',
      reason: 'Packaged builds always load the bundled renderer.'
    });
  });
});
