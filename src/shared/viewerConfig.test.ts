import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIEWER_URL,
  getViewerConfig,
  isAllowedLocalViewerUrl,
  normalizeViewerUrl
} from './viewerConfig';

describe('viewer configuration', () => {
  it('keeps the viewer URL configurable and normalizes localhost values', () => {
    const config = getViewerConfig({
      MAESTRO_VIEWER_URL: 'http://localhost:9999/viewer'
    });

    expect(config.url).toBe('http://localhost:9999/viewer');
    expect(config.source).toBe('env');
    expect(config.originalRequirementUrl).toBe('http://127.0.0.1:9999/');
    expect(config.maestroObservedUrl).toBe(DEFAULT_VIEWER_URL);
  });

  it('falls back to the observed Maestro viewer URL instead of hardcoding port 9999', () => {
    const config = getViewerConfig({});

    expect(config.url).toBe('http://127.0.0.1:10000/');
    expect(config.source).toBe('default');
  });

  it('allows only local viewer targets', () => {
    expect(isAllowedLocalViewerUrl('http://127.0.0.1:10000/')).toBe(true);
    expect(isAllowedLocalViewerUrl('http://localhost:9999/')).toBe(true);
    expect(isAllowedLocalViewerUrl('https://example.com:10000/')).toBe(false);
    expect(isAllowedLocalViewerUrl('not-a-url')).toBe(false);
  });

  it('normalizes viewer URLs with a trailing slash', () => {
    expect(normalizeViewerUrl('http://127.0.0.1:10000')).toBe('http://127.0.0.1:10000/');
  });
});
