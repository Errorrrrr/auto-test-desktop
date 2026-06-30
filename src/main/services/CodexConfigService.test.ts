import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CodexConfigService, resolveCodexConfigPath } from './CodexConfigService';

const tempRoots: string[] = [];

async function createCodexHome(): Promise<{
  configPath: string;
  codexHome: string;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'app-auto-test-codex-config-'));
  const codexHome = join(rootDir, 'codex-home');

  tempRoots.push(rootDir);
  await mkdir(codexHome, { recursive: true });

  return {
    configPath: join(codexHome, 'config.toml'),
    codexHome
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootDir) => rm(rootDir, { force: true, recursive: true })));
});

describe('CodexConfigService', () => {
  it('resolves CODEX_HOME/config.toml before the default home path', () => {
    expect(resolveCodexConfigPath({ CODEX_HOME: '/tmp/codex-home' }, '/Users/test')).toBe(
      '/tmp/codex-home/config.toml'
    );
    expect(resolveCodexConfigPath({}, '/Users/test')).toBe('/Users/test/.codex/config.toml');
  });

  it('reads the top-level model and profile model options from local Codex config', async () => {
    const { codexHome } = await createCodexHome();
    const service = new CodexConfigService({
      env: {
        CODEX_HOME: codexHome
      }
    });

    await writeFile(
      join(codexHome, 'config.toml'),
      'model = "gpt-5.5" # local default\n\n[profiles.smoke]\nmodel = "gpt-5-mini"\n\n[profiles."deep run"]\nmodel = "gpt-5.5-codex"\n',
      'utf8'
    );

    await expect(service.getConfig()).resolves.toMatchObject({
      path: join(codexHome, 'config.toml'),
      status: 'loaded',
      defaultModelName: 'gpt-5.5',
      modelOptions: [
        {
          id: 'codex-config-default',
          label: 'Codex config default',
          modelName: 'gpt-5.5',
          source: 'config_default'
        },
        {
          id: 'codex-profile-smoke',
          label: 'Codex profile smoke',
          modelName: 'gpt-5-mini',
          source: 'profile',
          profileName: 'smoke'
        },
        {
          id: 'codex-profile-deep-run',
          label: 'Codex profile deep run',
          modelName: 'gpt-5.5-codex',
          source: 'profile',
          profileName: 'deep run'
        }
      ]
    });
  });

  it('reads profile files as Codex config overlays with stable profile option ids', async () => {
    const { codexHome } = await createCodexHome();
    const service = new CodexConfigService({
      env: {
        CODEX_HOME: codexHome
      }
    });

    await writeFile(join(codexHome, 'config.toml'), 'model = "gpt-5"\n', 'utf8');
    await writeFile(join(codexHome, 'work.config.toml'), 'model = "gpt-5.5-codex"\n', 'utf8');
    await writeFile(join(codexHome, 'smoke_test.config.toml'), 'model_reasoning_effort = "low"\n', 'utf8');

    await expect(service.getConfig()).resolves.toMatchObject({
      path: join(codexHome, 'config.toml'),
      status: 'loaded',
      defaultModelName: 'gpt-5',
      modelOptions: [
        {
          id: 'codex-config-default',
          label: 'Codex config default',
          modelName: 'gpt-5',
          source: 'config_default'
        },
        {
          id: 'codex-profile-smoke_test',
          label: 'Codex profile smoke_test',
          modelName: 'gpt-5',
          source: 'profile',
          profileName: 'smoke_test'
        },
        {
          id: 'codex-profile-work',
          label: 'Codex profile work',
          modelName: 'gpt-5.5-codex',
          source: 'profile',
          profileName: 'work'
        }
      ]
    });
  });

  it('loads profile file models even when config.toml is missing', async () => {
    const { codexHome } = await createCodexHome();
    const service = new CodexConfigService({
      env: {
        CODEX_HOME: codexHome
      }
    });

    await writeFile(join(codexHome, 'deep-review.config.toml'), 'model = "gpt-5.5"\n', 'utf8');

    await expect(service.getConfig()).resolves.toMatchObject({
      path: join(codexHome, 'config.toml'),
      status: 'loaded',
      modelOptions: [
        {
          id: 'codex-profile-deep-review',
          label: 'Codex profile deep-review',
          modelName: 'gpt-5.5',
          source: 'profile',
          profileName: 'deep-review'
        }
      ],
      warning: expect.stringContaining('config.toml was not found')
    });
  });

  it('warns and keeps readable profile files when one profile file is unreadable', async () => {
    const { codexHome } = await createCodexHome();
    const service = new CodexConfigService({
      env: {
        CODEX_HOME: codexHome
      }
    });

    await writeFile(join(codexHome, 'config.toml'), 'model = "gpt-5"\n', 'utf8');
    await writeFile(join(codexHome, 'work.config.toml'), 'model = "gpt-5.5-codex"\n', 'utf8');
    await mkdir(join(codexHome, 'broken.config.toml'));

    await expect(service.getConfig()).resolves.toMatchObject({
      status: 'loaded',
      defaultModelName: 'gpt-5',
      modelOptions: expect.arrayContaining([
        expect.objectContaining({
          id: 'codex-profile-work',
          modelName: 'gpt-5.5-codex'
        })
      ]),
      warning: expect.stringContaining('broken.config.toml')
    });
  });

  it('uses the configured active profile model when no top-level model exists', async () => {
    const { configPath } = await createCodexHome();
    const service = new CodexConfigService({
      configPath
    });

    await writeFile(configPath, 'profile = "smoke"\n\n[profiles.smoke]\nmodel = "gpt-5-mini"\n', 'utf8');

    await expect(service.getConfig()).resolves.toMatchObject({
      status: 'loaded',
      activeProfile: 'smoke',
      defaultModelName: 'gpt-5-mini'
    });
  });

  it('reports a missing config file without throwing', async () => {
    const { configPath } = await createCodexHome();
    const service = new CodexConfigService({
      configPath: join(configPath, '..', 'missing.toml')
    });

    await expect(service.getConfig()).resolves.toMatchObject({
      status: 'not_found',
      modelOptions: [],
      warning: expect.stringContaining('not found')
    });
  });
});
