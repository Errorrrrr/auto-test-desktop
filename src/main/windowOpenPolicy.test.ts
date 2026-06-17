import { describe, expect, it } from 'vitest';

import { createViewerWindowOpenHandler, decideViewerWindowOpen } from './windowOpenPolicy';

describe('viewer window open policy', () => {
  it('allows only local viewer URLs to open new Electron windows', () => {
    expect(decideViewerWindowOpen('http://127.0.0.1:10000/')).toEqual({
      action: 'allow'
    });
    expect(decideViewerWindowOpen('http://localhost:9999/')).toEqual({
      action: 'allow'
    });
  });

  it('denies non-local URLs before Electron can open them', () => {
    const handler = createViewerWindowOpenHandler();

    expect(handler({ url: 'https://example.com:10000/' })).toEqual({
      action: 'deny'
    });
    expect(handler({ url: 'file:///tmp/viewer.html' })).toEqual({
      action: 'deny'
    });
  });
});
