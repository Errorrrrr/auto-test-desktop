import { describe, expect, it } from 'vitest';

import { createRuntimeSnapshot } from './runtimeSnapshot';
import { getViewerConfig } from './viewerConfig';

describe('runtime snapshot', () => {
  it('starts with no executable devices and disables test execution', () => {
    const snapshot = createRuntimeSnapshot(getViewerConfig({}));

    expect(snapshot.devices).toEqual([]);
    expect(snapshot.canStartRun).toBe(false);
    expect(snapshot.environment.maestro.status).toBe('not_configured');
    expect(snapshot.environment.viewer.url).toBe('http://127.0.0.1:10000/');
  });
});
