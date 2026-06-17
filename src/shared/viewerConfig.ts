import type { ViewerConfig } from './types';

export const ORIGINAL_REQUIREMENT_VIEWER_URL = 'http://127.0.0.1:9999/';
export const DEFAULT_VIEWER_URL = 'http://127.0.0.1:10000/';

type ViewerEnv = {
  MAESTRO_VIEWER_URL?: string;
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseViewerUrl(value: string): URL | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

export function normalizeViewerUrl(value: string): string {
  return parseViewerUrl(value)?.toString() ?? DEFAULT_VIEWER_URL;
}

export function isAllowedLocalHttpUrl(value: string): boolean {
  const parsed = parseViewerUrl(value);

  if (!parsed) {
    return false;
  }

  const isLocalHost = LOCAL_HOSTS.has(parsed.hostname);
  const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';

  return isLocalHost && isHttp;
}

export function isAllowedLocalViewerUrl(value: string): boolean {
  return isAllowedLocalHttpUrl(value);
}

export function getViewerConfig(env: ViewerEnv): ViewerConfig {
  const rawUrl = env.MAESTRO_VIEWER_URL?.trim();
  const url = normalizeViewerUrl(rawUrl || DEFAULT_VIEWER_URL);
  const allowed = isAllowedLocalViewerUrl(url);

  return {
    url,
    source: rawUrl ? 'env' : 'default',
    originalRequirementUrl: ORIGINAL_REQUIREMENT_VIEWER_URL,
    maestroObservedUrl: DEFAULT_VIEWER_URL,
    allowed,
    warning: allowed
      ? undefined
      : 'Viewer URL must point to localhost, 127.0.0.1, or ::1.'
  };
}
