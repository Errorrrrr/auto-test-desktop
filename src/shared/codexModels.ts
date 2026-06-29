import type { CodexModelPreset } from './types';

export const DEFAULT_CODEX_MODEL_NAME = 'gpt-5';

export const CODEX_MODEL_PRESETS: CodexModelPreset[] = [
  {
    id: 'gpt-5',
    label: 'GPT-5',
    modelName: 'gpt-5',
    recommended: true
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 mini',
    modelName: 'gpt-5-mini'
  }
];

export function getCodexModelPreset(presetId: string | undefined): CodexModelPreset | undefined {
  return CODEX_MODEL_PRESETS.find((preset) => preset.id === presetId);
}

export function getCodexModelPresetByModelName(modelName: string): CodexModelPreset | undefined {
  return CODEX_MODEL_PRESETS.find((preset) => preset.modelName === modelName);
}
