import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AppDataStorage } from '../storage/AppDataStorage';
import { AgentModelSettingsService } from './AgentModelSettingsService';
import { CodexConfigService } from './CodexConfigService';

const tempRoots: string[] = [];

async function createService(defaultModelName = 'gpt-5'): Promise<{
  codexHome: string;
  service: AgentModelSettingsService;
  storage: AppDataStorage;
  codexConfigPath: string;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'app-auto-test-model-settings-'));
  const storage = new AppDataStorage(join(rootDir, 'data'));
  const codexHome = join(rootDir, 'codex');
  const codexConfigPath = join(codexHome, 'config.toml');

  tempRoots.push(rootDir);
  await mkdir(codexHome, { recursive: true });

  return {
    codexHome,
    service: new AgentModelSettingsService({
      codexConfig: new CodexConfigService({
        configPath: codexConfigPath
      }),
      defaultModelName,
      storage
    }),
    storage,
    codexConfigPath
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

  it('uses the local Codex config model as the default when it is readable', async () => {
    const { service, codexConfigPath } = await createService('gpt-5');

    await writeFile(
      codexConfigPath,
      'model = "gpt-5.5"\n\n[profiles.smoke]\nmodel = "gpt-5-mini"\n',
      'utf8'
    );

    await expect(service.getModelSettings()).resolves.toMatchObject({
      defaultModelName: 'gpt-5.5',
      effective: {
        modelName: 'gpt-5.5',
        source: 'codex_config'
      },
      codexConfig: {
        status: 'loaded',
        defaultModelName: 'gpt-5.5',
        modelOptions: expect.arrayContaining([
          expect.objectContaining({
            id: 'codex-profile-smoke',
            modelName: 'gpt-5-mini',
            source: 'profile'
          })
        ])
      }
    });
  });

  it('saves a model option from the local Codex config', async () => {
    const { service, storage, codexConfigPath } = await createService();

    await writeFile(codexConfigPath, '[profiles.deep]\nmodel = "gpt-5.5"\n', 'utf8');

    const response = await service.saveModelSettings({
      modelName: 'gpt-5.5',
      source: 'codex_config'
    });
    const savedJson = await readFile(storage.getCodexModelSettingsPath(), 'utf8');

    expect(response).toMatchObject({
      settings: {
        modelName: 'gpt-5.5',
        source: 'codex_config'
      },
      effective: {
        modelName: 'gpt-5.5',
        source: 'codex_config'
      }
    });
    expect(JSON.parse(savedJson)).toMatchObject({
      modelName: 'gpt-5.5',
      source: 'codex_config'
    });
  });

  it('saves a model option that is only declared by a Codex profile file', async () => {
    const { codexHome, service, storage } = await createService();

    await writeFile(join(codexHome, 'work.config.toml'), 'model = "gpt-5.5-codex"\n', 'utf8');

    const response = await service.saveModelSettings({
      modelName: 'gpt-5.5-codex',
      source: 'codex_config'
    });
    const savedJson = await readFile(storage.getCodexModelSettingsPath(), 'utf8');

    expect(response).toMatchObject({
      settings: {
        modelName: 'gpt-5.5-codex',
        source: 'codex_config'
      },
      effective: {
        modelName: 'gpt-5.5-codex',
        source: 'codex_config'
      },
      codexConfig: {
        status: 'loaded',
        modelOptions: expect.arrayContaining([
          expect.objectContaining({
            id: 'codex-profile-work',
            modelName: 'gpt-5.5-codex',
            profileName: 'work'
          })
        ])
      }
    });
    expect(JSON.parse(savedJson)).toMatchObject({
      modelName: 'gpt-5.5-codex',
      source: 'codex_config'
    });
  });

  it('rejects Codex config source when the model is not in the local config', async () => {
    const { service, codexConfigPath } = await createService();

    await writeFile(codexConfigPath, 'model = "gpt-5"\n', 'utf8');

    await expect(
      service.saveModelSettings({
        modelName: 'gpt-5.5',
        source: 'codex_config'
      })
    ).rejects.toMatchObject({
      code: 'CODEX_MODEL_INVALID',
      message: expect.stringContaining('local Codex config')
    });
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
