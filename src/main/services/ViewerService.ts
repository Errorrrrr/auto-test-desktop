import type { ViewerConfig, ViewerProbeResult } from '../../shared/types';
import { getViewerConfig, isAllowedLocalViewerUrl, normalizeViewerUrl } from '../../shared/viewerConfig';
import { AppError } from './AppError';
import { requireStringField } from './validation';

type Fetcher = (
  input: string,
  init: {
    method: string;
    signal: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
}>;

type ViewerServiceOptions = {
  env: {
    MAESTRO_VIEWER_URL?: string;
  };
  fetcher?: Fetcher;
  timeoutMs?: number;
};

export class ViewerService {
  private readonly env: ViewerServiceOptions['env'];
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(options: ViewerServiceOptions) {
    this.env = options.env;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 2_000;
  }

  getConfig(): ViewerConfig {
    return getViewerConfig(this.env);
  }

  async probe(request: unknown): Promise<ViewerProbeResult> {
    const url = requireStringField(request, 'url');

    if (!isAllowedLocalViewerUrl(url)) {
      throw new AppError(
        'INVALID_VIEWER_URL',
        'Viewer URL must point to localhost, 127.0.0.1, or ::1.'
      );
    }

    const normalizedUrl = normalizeViewerUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(normalizedUrl, {
        method: 'GET',
        signal: controller.signal
      });

      return {
        url: normalizedUrl,
        allowed: true,
        reachable: response.ok ? 'reachable' : 'unreachable',
        detail: response.ok
          ? `Viewer responded with HTTP ${response.status}.`
          : `Viewer responded with HTTP ${response.status} ${response.statusText}`.trim()
      };
    } catch (error) {
      return {
        url: normalizedUrl,
        allowed: true,
        reachable: 'unreachable',
        detail: error instanceof Error ? error.message : 'Viewer target is unreachable.'
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
