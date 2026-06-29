import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AppDataStorage } from '../storage/AppDataStorage';
import { AgentModelSettingsService } from './AgentModelSettingsService';

const tempRoots: string[] = [];

async function createService(defaultModelName = 'gpt-5'): Promise<{
  service: AgentModelSettingsService;
  storage: AppDataStorage;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'app-auto-test-model-settings-'));
  const storage = new AppDataStorage(join(rootDir, 'data'));

  tempRoots.push(rootDir);

  return {
    service: new AgentModelSettingsService({
      defaultModelName,
      storage
    }),
    storage
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootDir) => rm(rootDir, { force: true, recursive: true })));
});

describe('AgentModelSettingsService', () => {
  it('returns an explicit app default model when no settings have been saved', async () => {
    const { service } = await createService('gpt-5-mini');
    const response = await service.getModelSettings();

    expect(response).toMatchObject({
      defaultModelName: 'gpt-5-mini',
      effective: {
        modelName: 'gpt-5-mini',
        source: 'app_default'
      },
      presets: expect.arrayContaining([
        expect.objectContaining({
          id: 'gpt-5',
          modelName: 'gpt-5'
        })
      ])
    });
    expect(response.settings).toBeUndefined();
    expect(response.effective.capturedAt).toEqual(expect.any(String));
  });

  it('saves preset settings and exposes the saved model as the effective snapshot', async () => {
    const { service, storage } = await createService();
    const response = await service.saveModelSettings({
      modelName: 'gpt-5-mini',
      source: 'preset',
      presetId: 'gpt-5-mini'
    });
    const savedJson = await readFile(storage.getCodexModelSettingsPath(), 'utf8');

    expect(response).toMatchObject({
      settings: {
        modelName: 'gpt-5-mini',
        source: 'preset',
        presetId: 'gpt-5-mini'
      },
      effective: {
        modelName: 'gpt-5-mini',
        source: 'preset',
        presetId: 'gpt-5-mini'
      }
    });
    expect(JSON.parse(savedJson)).toMatchObject({
      modelName: 'gpt-5-mini',
      source: 'preset',
      presetId: 'gpt-5-mini'
    });
  });

  it('rejects unsafe custom model names before overwriting the existing settings file', async () => {
    const { service, storage } = await createService();

    await service.saveModelSettings({
      modelName: 'gpt-5',
      source: 'preset',
      presetId: 'gpt-5'
    });
    const before = await readFile(storage.getCodexModelSettingsPath(), 'utf8');

    await expect(
      service.saveModelSettings({
        modelName: 'gpt-5;rm',
        source: 'custom'
      })
    ).rejects.toMatchObject({
      code: 'CODEX_MODEL_INVALID'
    });
    await expect(readFile(storage.getCodexModelSettingsPath(), 'utf8')).resolves.toBe(before);
  });

  it('reports corrupt settings and keeps the app default active until settings are saved again', async () => {
    const { service, storage } = await createService();

    await storage.ensure();
    await writeFile(storage.getCodexModelSettingsPath(), '{not json', 'utf8');

    await expect(service.getModelSettings()).resolves.toMatchObject({
      effective: {
        modelName: 'gpt-5',
        source: 'app_default'
      },
      warning: expect.stringContaining('unreadable or invalid')
    });
  });

  it('rejects preset settings when the preset id and model name do not match', async () => {
    const { service } = await createService();

    await expect(
      service.saveModelSettings({
        modelName: 'gpt-5',
        source: 'preset',
        presetId: 'gpt-5-mini'
      })
    ).rejects.toMatchObject({
      code: 'CODEX_MODEL_INVALID',
      message: expect.stringContaining('does not match')
    });
  });

  it('clears saved settings when the app default model source is selected again', async () => {
    const { service, storage } = await createService();

    await service.saveModelSettings({
      modelName: 'gpt-5-mini',
      source: 'preset',
      presetId: 'gpt-5-mini'
    });

    const response = await service.saveModelSettings({
      modelName: 'gpt-5',
      source: 'app_default'
    });

    expect(response).toMatchObject({
      effective: {
        modelName: 'gpt-5',
        source: 'app_default'
      }
    });
    expect(response.settings).toBeUndefined();
    await expect(readFile(storage.getCodexModelSettingsPath(), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });
});
