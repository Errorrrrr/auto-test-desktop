import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AppDataStorage } from '../storage/AppDataStorage';
import { TestCaseService } from './TestCaseService';

const tempRoots: string[] = [];

async function createService(maxUploadSizeBytes = 1024 * 1024): Promise<{
  rootDir: string;
  service: TestCaseService;
  storage: AppDataStorage;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'app-auto-test-case-'));
  const storage = new AppDataStorage(join(rootDir, 'data'));

  tempRoots.push(rootDir);

  return {
    rootDir,
    service: new TestCaseService({
      maxUploadSizeBytes,
      storage
    }),
    storage
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootDir) => rm(rootDir, { force: true, recursive: true })));
});

describe('TestCaseService', () => {
  it('copies YAML test cases into appData and records a manifest', async () => {
    const { rootDir, service, storage } = await createService();
    const sourcePath = join(rootDir, 'smoke.yaml');

    await writeFile(sourcePath, 'appId: com.example.app\n---\n- launchApp\n', 'utf8');

    const manifest = await service.importCase({
      sourcePath,
      displayName: 'Smoke flow'
    });
    const storedManifest = await storage.getTestCaseStore().get(manifest.id);

    expect(manifest).toMatchObject({
      name: 'Smoke flow',
      sourcePath,
      originalSourcePath: sourcePath,
      format: 'yaml',
      status: 'imported',
      validationMessages: []
    });
    expect(manifest.storedPath).toContain('/testcases/');
    await expect(readFile(manifest.storedPath ?? '', 'utf8')).resolves.toContain('launchApp');
    expect(storedManifest).toMatchObject({
      id: manifest.id,
      storedPath: manifest.storedPath
    });
  });

  it('rejects empty YAML as an invalid test case', async () => {
    const { rootDir, service } = await createService();
    const sourcePath = join(rootDir, 'empty.yaml');

    await writeFile(sourcePath, '# comments only\n---\n', 'utf8');

    await expect(service.importCase({ sourcePath })).rejects.toMatchObject({
      code: 'INVALID_TEST_CASE',
      message: expect.stringContaining('empty')
    });
  });

  it('rejects unsupported extensions before copying files', async () => {
    const { rootDir, service } = await createService();
    const sourcePath = join(rootDir, 'notes.txt');

    await writeFile(sourcePath, 'not a flow', 'utf8');

    await expect(service.importCase({ sourcePath })).rejects.toMatchObject({
      code: 'UNSUPPORTED_TEST_CASE_FORMAT'
    });
  });

  it('rejects zip imports until safe extraction is implemented', async () => {
    const { rootDir, service } = await createService();
    const sourcePath = join(rootDir, 'flows.zip');

    await writeFile(sourcePath, 'not a real zip', 'utf8');

    await expect(service.importCase({ sourcePath })).rejects.toMatchObject({
      code: 'ZIP_TEST_CASE_NOT_SUPPORTED',
      message: expect.stringContaining('not enabled in P0')
    });
  });

  it('enforces the configured upload size limit', async () => {
    const { rootDir, service } = await createService(8);
    const sourcePath = join(rootDir, 'large.yaml');

    await writeFile(sourcePath, 'appId: com.example.app\n- launchApp\n', 'utf8');

    await expect(service.importCase({ sourcePath })).rejects.toMatchObject({
      code: 'TEST_CASE_TOO_LARGE',
      message: expect.stringContaining('max upload size')
    });
  });
});
