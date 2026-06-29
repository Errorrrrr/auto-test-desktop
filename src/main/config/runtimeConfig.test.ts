import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRuntimeConfig } from './runtimeConfig';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootDir) => rm(rootDir, { force: true, recursive: true })));
});

describe('runtime config', () => {
  it('resolves Android tools from the configured SDK root before falling back to PATH', async () => {
    const sdkRoot = join(tmpdir(), `app-auto-test-sdk-${Date.now()}`);
    const adbPath = join(sdkRoot, 'platform-tools', 'adb');
    const emulatorPath = join(sdkRoot, 'emulator', 'emulator');

    tempRoots.push(sdkRoot);
    await mkdir(join(sdkRoot, 'platform-tools'), { recursive: true });
    await mkdir(join(sdkRoot, 'emulator'), { recursive: true });
    await writeFile(adbPath, '');
    await writeFile(emulatorPath, '');

    const config = createRuntimeConfig({
      ANDROID_HOME: sdkRoot
    });

    expect(config.adbPath).toBe(adbPath);
    expect(config.androidEmulatorPath).toBe(emulatorPath);
  });

  it('keeps the optional default Maestro app id for natural-language runs', () => {
    const config = createRuntimeConfig({
      MAESTRO_APP_ID: ' com.example.app '
    });

    expect(config.maestroAppId).toBe('com.example.app');
  });

  it('defaults Codex service tier to fast and allows flex override', () => {
    expect(createRuntimeConfig({}).agentCodexServiceTier).toBe('fast');
    expect(createRuntimeConfig({ AGENT_CODEX_SERVICE_TIER: ' flex ' }).agentCodexServiceTier).toBe('flex');
    expect(createRuntimeConfig({ AGENT_CODEX_SERVICE_TIER: ' default ' }).agentCodexServiceTier).toBe('fast');
  });

  it('uses a single Codex model default with an environment override', () => {
    expect(createRuntimeConfig({}).agentCodexModelName).toBe('gpt-5');
    expect(createRuntimeConfig({ AGENT_CODEX_MODEL: ' gpt-5-mini ' }).agentCodexModelName).toBe('gpt-5-mini');
  });
});
