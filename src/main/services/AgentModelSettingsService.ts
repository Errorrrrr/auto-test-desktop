import { readFile, unlink, writeFile } from 'node:fs/promises';

import {
  CODEX_MODEL_PRESETS,
  DEFAULT_CODEX_MODEL_NAME
} from '../../shared/codexModels';
import type {
  CodexModelPreset,
  CodexModelSettings,
  CodexModelSettingsResponse,
  CodexModelSnapshot,
  CodexModelSource
} from '../../shared/types';
import type { AppDataStorage } from '../storage/AppDataStorage';
import { AppError } from './AppError';
import { requireRecord } from './validation';

const CODEX_MODEL_NAME_PATTERN = /^[A-Za-z0-9._:/-]+$/;
const MAX_CODEX_MODEL_NAME_LENGTH = 128;

interface StoredSettingsResult {
  settings?: CodexModelSettings;
  warning?: string;
}

interface AgentModelSettingsServiceOptions {
  defaultModelName?: string;
  presets?: CodexModelPreset[];
  storage: AppDataStorage;
}

export class AgentModelSettingsService {
  private readonly defaultModelName: string;
  private readonly presets: CodexModelPreset[];
  private readonly storage: AppDataStorage;

  constructor(options: AgentModelSettingsServiceOptions) {
    this.defaultModelName = validateModelName(
      options.defaultModelName ?? DEFAULT_CODEX_MODEL_NAME,
      'Default Codex model'
    );
    this.presets = options.presets ?? CODEX_MODEL_PRESETS;
    this.storage = options.storage;
    validatePresets(this.presets);
  }

  async getModelSettings(): Promise<CodexModelSettingsResponse> {
    const stored = await this.readStoredSettings();

    return this.buildResponse(stored);
  }

  async saveModelSettings(request: unknown): Promise<CodexModelSettingsResponse> {
    const settings = this.parseSaveRequest(request);

    if (settings.source === 'app_default') {
      await this.clearStoredSettings();

      return this.buildResponse();
    }

    try {
      await this.storage.ensure();
      await writeFile(this.storage.getCodexModelSettingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    } catch (error) {
      throw new AppError(
        'CODEX_MODEL_SAVE_FAILED',
        `Codex model settings could not be saved: ${error instanceof Error ? error.message : 'Unknown error.'}`
      );
    }

    return this.buildResponse({
      settings
    });
  }

  async getEffectiveSnapshot(): Promise<CodexModelSnapshot> {
    const response = await this.getModelSettings();

    return response.effective;
  }

  private async clearStoredSettings(): Promise<void> {
    try {
      await this.storage.ensure();
      await unlink(this.storage.getCodexModelSettingsPath());
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }

      throw new AppError(
        'CODEX_MODEL_SAVE_FAILED',
        `Codex model settings could not be reset: ${error instanceof Error ? error.message : 'Unknown error.'}`
      );
    }
  }

  private buildResponse(stored: StoredSettingsResult = {}): CodexModelSettingsResponse {
    return {
      ...(stored.settings ? { settings: stored.settings } : {}),
      effective: this.toSnapshot(stored.settings),
      presets: this.presets.map((preset) => ({ ...preset })),
      defaultModelName: this.defaultModelName,
      ...(stored.warning ? { warning: stored.warning } : {})
    };
  }

  private async readStoredSettings(): Promise<StoredSettingsResult> {
    try {
      const raw = await readFile(this.storage.getCodexModelSettingsPath(), 'utf8');
      const parsed = JSON.parse(raw) as unknown;

      return {
        settings: this.parseStoredSettings(parsed)
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return {};
      }

      return {
        warning:
          'Codex model settings are unreadable or invalid. The app default model is active until settings are saved again.'
      };
    }
  }

  private parseSaveRequest(request: unknown): CodexModelSettings {
    const record = requireRecord(request, 'Codex model settings');
    const source = parseSource(record.source);
    const presetId = parseOptionalString(record.presetId);
    const modelName = validateModelName(record.modelName, 'Codex model name');

    return normalizeSettings({
      modelName,
      presetId,
      presets: this.presets,
      source,
      updatedAt: new Date().toISOString()
    });
  }

  private parseStoredSettings(value: unknown): CodexModelSettings {
    const record = requireRecord(value, 'Codex model settings file');
    const source = parseSource(record.source);
    const presetId = parseOptionalString(record.presetId);
    const modelName = validateModelName(record.modelName, 'Codex model name');
    const updatedAt = parseUpdatedAt(record.updatedAt);

    return normalizeSettings({
      modelName,
      presetId,
      presets: this.presets,
      source,
      updatedAt
    });
  }

  private toSnapshot(settings: CodexModelSettings | undefined): CodexModelSnapshot {
    const capturedAt = new Date().toISOString();

    if (settings) {
      return {
        modelName: settings.modelName,
        source: settings.source,
        ...(settings.presetId ? { presetId: settings.presetId } : {}),
        capturedAt,
        settingsUpdatedAt: settings.updatedAt
      };
    }

    return {
      modelName: this.defaultModelName,
      source: 'app_default',
      capturedAt
    };
  }
}

function normalizeSettings(options: {
  modelName: string;
  presetId?: string;
  presets: CodexModelPreset[];
  source: CodexModelSource;
  updatedAt: string;
}): CodexModelSettings {
  if (options.source === 'preset') {
    const preset = options.presetId
      ? options.presets.find((candidate) => candidate.id === options.presetId)
      : options.presets.find((candidate) => candidate.modelName === options.modelName);

    if (!preset) {
      throw new AppError('CODEX_MODEL_INVALID', 'Selected Codex model preset is not available.');
    }

    if (preset.modelName !== options.modelName) {
      throw new AppError('CODEX_MODEL_INVALID', 'Codex model preset does not match the selected model name.');
    }

    return {
      modelName: preset.modelName,
      source: 'preset',
      presetId: preset.id,
      updatedAt: options.updatedAt
    };
  }

  if (options.source === 'app_default') {
    return {
      modelName: options.modelName,
      source: 'app_default',
      updatedAt: options.updatedAt
    };
  }

  return {
    modelName: options.modelName,
    source: 'custom',
    updatedAt: options.updatedAt
  };
}

function validatePresets(presets: CodexModelPreset[]): void {
  const ids = new Set<string>();

  for (const preset of presets) {
    if (ids.has(preset.id)) {
      throw new AppError('CODEX_MODEL_INVALID', `Duplicate Codex model preset id: ${preset.id}`);
    }

    ids.add(preset.id);
    validateModelName(preset.modelName, `Codex model preset ${preset.id}`);
  }
}

function validateModelName(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new AppError('CODEX_MODEL_INVALID', `${label} must be a string.`);
  }

  const modelName = value.trim();

  if (!modelName) {
    throw new AppError('CODEX_MODEL_INVALID', `${label} is required.`);
  }

  if (modelName.length > MAX_CODEX_MODEL_NAME_LENGTH) {
    throw new AppError('CODEX_MODEL_INVALID', `${label} must be ${MAX_CODEX_MODEL_NAME_LENGTH} characters or fewer.`);
  }

  if (!CODEX_MODEL_NAME_PATTERN.test(modelName)) {
    throw new AppError(
      'CODEX_MODEL_INVALID',
      `${label} may only contain letters, numbers, dots, underscores, colons, slashes, and hyphens.`
    );
  }

  return modelName;
}

function parseSource(value: unknown): CodexModelSource {
  if (value === 'app_default' || value === 'preset' || value === 'custom') {
    return value;
  }

  throw new AppError('CODEX_MODEL_INVALID', 'Codex model source must be app_default, preset, or custom.');
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new AppError('CODEX_MODEL_INVALID', 'Codex model preset id must be a string.');
  }

  return value.trim() || undefined;
}

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new AppError('CODEX_MODEL_INVALID', 'Codex model settings updatedAt is invalid.');
  }

  return value;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
