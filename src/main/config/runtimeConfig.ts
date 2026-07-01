import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_CODEX_MODEL_NAME } from '../../shared/codexModels';

export type MaestroProviderMode = 'cli' | 'mcp' | 'disabled';

export interface RuntimeEnv {
  AGENT_CODEX_MODEL?: string;
  ADB_PATH?: string;
  AGENT_CODEX_SERVICE_TIER?: string;
  APP_AUTO_TEST_DATA_DIR?: string;
  AGENT_COMMAND?: string;
  AGENT_PROVIDER?: string;
  ANDROID_HOME?: string;
  ANDROID_EMULATOR_PATH?: string;
  ANDROID_SDK_ROOT?: string;
  CODEX_HOME?: string;
  MAESTRO_CLI_PATH?: string;
  MAESTRO_APP_ID?: string;
  MAESTRO_PROVIDER?: string;
  MAESTRO_VIEWER_URL?: string;
  MAX_UPLOAD_SIZE_MB?: string;
  RUN_TIMEOUT_MS?: string;
  XCRUN_PATH?: string;
}

export interface RuntimeConfig {
  adbPath: string;
  agentCodexModelName: string;
  agentCodexServiceTier: 'fast' | 'flex';
  agentCommand?: string;
  agentProvider: string;
  androidEmulatorPath: string;
  dataRoot: string;
  maestroAppId?: string;
  maestroCliPath: string;
  maestroProvider: MaestroProviderMode;
  maxUploadSizeBytes: number;
  runTimeoutMs: number;
  xcrunPath: string;
}

const DEFAULT_MAX_UPLOAD_SIZE_MB = 25;
const DEFAULT_RUN_TIMEOUT_MS = 600_000;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseMaestroProvider(value: string | undefined): MaestroProviderMode {
  if (value === 'mcp' || value === 'disabled') {
    return value;
  }

  return 'cli';
}

function parseCodexServiceTier(value: string | undefined): 'fast' | 'flex' {
  return value?.trim() === 'flex' ? 'flex' : 'fast';
}

function resolveAndroidSdkToolPath(
  env: RuntimeEnv,
  relativePath: string[],
  fallback: string
): string {
  const sdkRoots = [
    env.ANDROID_HOME?.trim(),
    env.ANDROID_SDK_ROOT?.trim(),
    join(homedir(), 'Library', 'Android', 'sdk')
  ].filter((value): value is string => Boolean(value));

  for (const sdkRoot of sdkRoots) {
    const candidate = join(sdkRoot, ...relativePath);

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return fallback;
}

export function createRuntimeConfig(
  env: RuntimeEnv,
  defaults: {
    dataRoot?: string;
  } = {}
): RuntimeConfig {
  const dataRoot = env.APP_AUTO_TEST_DATA_DIR?.trim() || defaults.dataRoot || join(process.cwd(), '.app-auto-test-data');
  const maxUploadSizeMb = parsePositiveInteger(env.MAX_UPLOAD_SIZE_MB, DEFAULT_MAX_UPLOAD_SIZE_MB);

  return {
    adbPath: env.ADB_PATH?.trim() || resolveAndroidSdkToolPath(env, ['platform-tools', 'adb'], 'adb'),
    agentCodexModelName: env.AGENT_CODEX_MODEL?.trim() || DEFAULT_CODEX_MODEL_NAME,
    agentCodexServiceTier: parseCodexServiceTier(env.AGENT_CODEX_SERVICE_TIER),
    agentProvider: env.AGENT_PROVIDER?.trim() || 'codex',
    agentCommand: env.AGENT_COMMAND?.trim() || ((env.AGENT_PROVIDER?.trim() || 'codex') === 'codex' ? 'codex' : undefined),
    androidEmulatorPath:
      env.ANDROID_EMULATOR_PATH?.trim() || resolveAndroidSdkToolPath(env, ['emulator', 'emulator'], 'emulator'),
    dataRoot,
    maestroAppId: env.MAESTRO_APP_ID?.trim() || undefined,
    maestroCliPath: env.MAESTRO_CLI_PATH?.trim() || 'maestro',
    maestroProvider: parseMaestroProvider(env.MAESTRO_PROVIDER),
    maxUploadSizeBytes: maxUploadSizeMb * 1024 * 1024,
    runTimeoutMs: parsePositiveInteger(env.RUN_TIMEOUT_MS, DEFAULT_RUN_TIMEOUT_MS),
    xcrunPath: env.XCRUN_PATH?.trim() || 'xcrun'
  };
}
