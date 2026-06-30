import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { CodexConfigModelOption, CodexConfigStatus, CodexConfigSummary } from '../../shared/types';

interface CodexConfigServiceOptions {
  configPath?: string;
  env?: {
    CODEX_HOME?: string;
  };
  homeDir?: string;
}

interface ParsedCodexConfig {
  activeProfile?: string;
  defaultModelName?: string;
  profileModels: Array<{
    modelName: string;
    profileName: string;
  }>;
  topLevelModelName?: string;
}

export class CodexConfigService {
  private readonly codexHome: string;
  private readonly configPath: string;

  constructor(options: CodexConfigServiceOptions = {}) {
    this.configPath = options.configPath ?? resolveCodexConfigPath(options.env, options.homeDir);
    this.codexHome = dirname(this.configPath);
  }

  async getConfig(): Promise<CodexConfigSummary> {
    const warnings: string[] = [];
    let baseConfigStatus: CodexConfigStatus = 'loaded';
    let parsedBaseConfig: ParsedCodexConfig | undefined;

    try {
      const raw = await readFile(this.configPath, 'utf8');
      parsedBaseConfig = parseCodexConfigToml(raw);
    } catch (error) {
      if (isNotFoundError(error)) {
        baseConfigStatus = 'not_found';
        warnings.push(
          'Codex config.toml was not found. The app fallback model is active until Codex config is created or a model is saved.'
        );
      } else {
        return {
          path: this.configPath,
          status: 'unreadable',
          modelOptions: [],
          warning:
            'Codex config.toml could not be read. The app fallback model is active until Codex config is readable or a model is saved.'
        };
      }
    }

    const fileProfileModels = await this.readProfileFileModels(parsedBaseConfig?.topLevelModelName, warnings);
    const profileModels = mergeProfileModels(parsedBaseConfig?.profileModels ?? [], fileProfileModels);
    const activeProfileModel = parsedBaseConfig?.activeProfile
      ? profileModels.find((entry) => entry.profileName === parsedBaseConfig.activeProfile)?.modelName
      : undefined;
    const defaultModelName = parsedBaseConfig?.topLevelModelName ?? activeProfileModel;
    const status: CodexConfigStatus =
      parsedBaseConfig || profileModels.length > 0 ? 'loaded' : baseConfigStatus;
    const parsed: ParsedCodexConfig = {
      ...(parsedBaseConfig?.activeProfile ? { activeProfile: parsedBaseConfig.activeProfile } : {}),
      ...(defaultModelName ? { defaultModelName } : {}),
      profileModels,
      ...(parsedBaseConfig?.topLevelModelName ? { topLevelModelName: parsedBaseConfig.topLevelModelName } : {})
    };

    if (!defaultModelName) {
      warnings.push(
        'Codex config does not declare a default model. The app fallback model is active until Codex config is updated or a model is saved.'
      );
    }

    return {
      path: this.configPath,
      status,
      ...(parsed.activeProfile ? { activeProfile: parsed.activeProfile } : {}),
      ...(defaultModelName ? { defaultModelName } : {}),
      modelOptions: buildModelOptions(parsed),
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {})
    };
  }

  private async readProfileFileModels(
    baseModelName: string | undefined,
    warnings: string[]
  ): Promise<ParsedCodexConfig['profileModels']> {
    let entries: string[];

    try {
      entries = await readdir(this.codexHome);
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }

      warnings.push('Codex profile config files could not be listed.');
      return [];
    }

    const profileModels: ParsedCodexConfig['profileModels'] = [];
    const profileConfigSuffix = '.config.toml';

    for (const fileName of entries.filter((entry) => entry.endsWith(profileConfigSuffix)).sort()) {
      const profileName = fileName.slice(0, -profileConfigSuffix.length).trim();

      if (!profileName) {
        continue;
      }

      try {
        const raw = await readFile(join(this.codexHome, fileName), 'utf8');
        const parsed = parseCodexConfigToml(raw);
        const modelName = parsed.topLevelModelName ?? baseModelName;

        if (!modelName) {
          warnings.push(`Codex profile config ${fileName} does not declare or inherit a model.`);
          continue;
        }

        profileModels.push({
          profileName,
          modelName
        });
      } catch {
        warnings.push(`Codex profile config ${fileName} could not be read.`);
      }
    }

    return profileModels;
  }
}

export function resolveCodexConfigPath(
  env: { CODEX_HOME?: string } = {},
  homeDir = homedir()
): string {
  const codexHome = env.CODEX_HOME?.trim() || join(homeDir, '.codex');

  return join(codexHome, 'config.toml');
}

function parseCodexConfigToml(raw: string): ParsedCodexConfig {
  let sectionPath: string[] = [];
  let activeProfile: string | undefined;
  let topLevelModelName: string | undefined;
  const profileModels: ParsedCodexConfig['profileModels'] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();

    if (!line) {
      continue;
    }

    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);

    if (sectionMatch) {
      sectionPath = parseTomlPath(sectionMatch[1] ?? '');
      continue;
    }

    const keyValueMatch = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);

    if (!keyValueMatch) {
      continue;
    }

    const key = keyValueMatch[1];
    const value = parseTomlString(keyValueMatch[2] ?? '');

    if (!value) {
      continue;
    }

    if (sectionPath.length === 0 && (key === 'profile' || key === 'default_profile')) {
      activeProfile = value;
      continue;
    }

    if (key !== 'model') {
      continue;
    }

    if (sectionPath.length === 0) {
      topLevelModelName = value;
      continue;
    }

    if (sectionPath[0] === 'profiles' && sectionPath[1]) {
      profileModels.push({
        profileName: sectionPath[1],
        modelName: value
      });
    }
  }

  return {
    ...(activeProfile ? { activeProfile } : {}),
    profileModels,
    ...(topLevelModelName ? { topLevelModelName } : {})
  };
}

function mergeProfileModels(
  legacyProfiles: ParsedCodexConfig['profileModels'],
  fileProfiles: ParsedCodexConfig['profileModels']
): ParsedCodexConfig['profileModels'] {
  const merged = new Map<string, string>();

  for (const profile of legacyProfiles) {
    merged.set(profile.profileName, profile.modelName);
  }

  for (const profile of fileProfiles) {
    merged.set(profile.profileName, profile.modelName);
  }

  return Array.from(merged, ([profileName, modelName]) => ({
    profileName,
    modelName
  }));
}

function buildModelOptions(parsed: ParsedCodexConfig): CodexConfigModelOption[] {
  const options: CodexConfigModelOption[] = [];

  if (parsed.defaultModelName) {
    options.push({
      id: 'codex-config-default',
      label: 'Codex config default',
      modelName: parsed.defaultModelName,
      source: 'config_default'
    });
  }

  for (const profile of parsed.profileModels) {
    options.push({
      id: `codex-profile-${sanitizeOptionId(profile.profileName)}`,
      label: `Codex profile ${profile.profileName}`,
      modelName: profile.modelName,
      source: 'profile',
      profileName: profile.profileName
    });
  }

  return dedupeModelOptions(options);
}

function dedupeModelOptions(options: CodexConfigModelOption[]): CodexConfigModelOption[] {
  const seen = new Set<string>();
  const deduped: CodexConfigModelOption[] = [];

  for (const option of options) {
    const key = `${option.source}:${option.profileName ?? ''}:${option.modelName}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(option);
  }

  return deduped;
}

function sanitizeOptionId(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-');

  return sanitized || 'unnamed';
}

function stripTomlComment(value: string): string {
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (quote === '"' && char === '\\') {
      escaping = true;
      continue;
    }

    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = undefined;
      continue;
    }

    if (char === '#' && !quote) {
      return value.slice(0, index);
    }
  }

  return value;
}

function parseTomlPath(value: string): string[] {
  return splitTomlPath(value)
    .map((part) => parseTomlString(part.trim()) ?? part.trim())
    .filter(Boolean);
}

function splitTomlPath(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (quote === '"' && char === '\\') {
      escaping = true;
      continue;
    }

    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = undefined;
      continue;
    }

    if (char === '.' && !quote) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(value.slice(start));

  return parts;
}

function parseTomlString(value: string): string | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('"')) {
    const match = /^"((?:\\.|[^"\\])*)"/.exec(trimmed);

    return match ? unescapeTomlBasicString(match[1] ?? '') : undefined;
  }

  if (trimmed.startsWith("'")) {
    const match = /^'([^']*)'/.exec(trimmed);

    return match?.[1];
  }

  const bare = /^[A-Za-z0-9._:/-]+/.exec(trimmed)?.[0];

  return bare || undefined;
}

function unescapeTomlBasicString(value: string): string {
  return value.replace(/\\(["\\btnfr])/g, (_match, escaped: string) => {
    const replacements: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t'
    };

    return replacements[escaped] ?? escaped;
  });
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
