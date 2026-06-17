import { describe, expect, it } from 'vitest';

import { ViewerService } from './ViewerService';

describe('ViewerService', () => {
  it('probes only localhost viewer URLs', async () => {
    const service = new ViewerService({
      env: {},
      fetcher: async () => ({
        ok: true,
        status: 200,
        statusText: 'OK'
      })
    });

    await expect(service.probe({ url: 'http://127.0.0.1:10000/' })).resolves.toMatchObject({
      allowed: true,
      reachable: 'reachable'
    });
    await expect(service.probe({ url: 'https://viewer.example.com/' })).rejects.toMatchObject({
      code: 'INVALID_VIEWER_URL',
      message: expect.stringContaining('localhost')
    });
  });

  it('reports local viewer fetch failures as unreachable', async () => {
    const service = new ViewerService({
      env: {},
      fetcher: async () => {
        throw new Error('connect ECONNREFUSED');
      }
    });

    await expect(service.probe({ url: 'http://localhost:9999/' })).resolves.toMatchObject({
      allowed: true,
      reachable: 'unreachable',
      detail: 'connect ECONNREFUSED'
    });
  });
});
