import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  localizeText,
  persistLanguage,
  readStoredLanguage
} from './rendererI18n';

describe('renderer language persistence', () => {
  it('defaults to Chinese when no supported language is stored', () => {
    expect(readStoredLanguage({ getItem: vi.fn(() => null) })).toBe(DEFAULT_LANGUAGE);
    expect(readStoredLanguage({ getItem: vi.fn(() => 'fr') })).toBe(DEFAULT_LANGUAGE);
  });

  it('reads and persists supported language selections', () => {
    const storage = {
      getItem: vi.fn(() => 'en'),
      setItem: vi.fn()
    };

    expect(readStoredLanguage(storage)).toBe('en');
    persistLanguage('zh', storage);
    expect(storage.setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'zh');
  });
});

describe('renderer text localization', () => {
  it('localizes known dynamic runtime messages', () => {
    expect(localizeText('Run run-1 finished as succeeded.', 'zh')).toBe('运行 run-1 已结束，状态：成功。');
    expect(localizeText('Markdown exported to /tmp/report.md.', 'zh')).toBe(
      'Markdown 已导出到 /tmp/report.md。'
    );
  });

  it('keeps unknown runtime text untouched', () => {
    expect(localizeText('custom runtime error', 'zh')).toBe('custom runtime error');
    expect(localizeText('Run run-1 finished as succeeded.', 'en')).toBe(
      'Run run-1 finished as succeeded.'
    );
  });
});
