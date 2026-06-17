import { join } from 'node:path';

export function resolvePreloadPath(currentDir: string): string {
  return join(currentDir, '../preload/index.mjs');
}
