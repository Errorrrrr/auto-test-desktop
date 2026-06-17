import { join } from 'node:path';

export type MaestroProviderMode = 'cli' | 'mcp' | 'disabled';

export interface RuntimeEnv {
  APP_AUTO_TEST_DATA_DIR?: string;
  AGENT_COMMAND?: string;
  AGENT_PROVIDER?: string;
  MAESTRO_CLI_PATH?: string;
  MAESTRO_PROVIDER?: string;
  MAESTRO_VIEWER_URL?: string;
  MAX_UPLOAD_SIZE_MB?: string;
  RUN_TIMEOUT_MS?: string;
}

export interface RuntimeConfig {
  agentCommand?: string;
  agentProvider: string;
  dataRoot: string;
  maestroCliPath: string;
  maestroProvider: MaestroProviderMode;
  maxUploadSizeBytes: number;
  runTimeoutMs: number;
}

const DEFAULT_MAX_UPLOAD_SIZE_MB = 25;
const DEFAULT_RUN_TIMEOUT_MS = 300_000;

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

export function createRuntimeConfig(
  env: RuntimeEnv,
  defaults: {
    dataRoot?: string;
  } = {}
): RuntimeConfig {
  const dataRoot = env.APP_AUTO_TEST_DATA_DIR?.trim() || defaults.dataRoot || join(process.cwd(), '.app-auto-test-data');
  const maxUploadSizeMb = parsePositiveInteger(env.MAX_UPLOAD_SIZE_MB, DEFAULT_MAX_UPLOAD_SIZE_MB);

  return {
    agentCommand: env.AGENT_COMMAND?.trim() || undefined,
    agentProvider: env.AGENT_PROVIDER?.trim() || 'manual-ready',
    dataRoot,
    maestroCliPath: env.MAESTRO_CLI_PATH?.trim() || 'maestro',
    maestroProvider: parseMaestroProvider(env.MAESTRO_PROVIDER),
    maxUploadSizeBytes: maxUploadSizeMb * 1024 * 1024,
    runTimeoutMs: parsePositiveInteger(env.RUN_TIMEOUT_MS, DEFAULT_RUN_TIMEOUT_MS)
  };
}
