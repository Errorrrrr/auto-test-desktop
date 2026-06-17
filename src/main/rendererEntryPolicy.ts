import { isAllowedLocalHttpUrl, normalizeViewerUrl } from '../shared/viewerConfig';

export type RendererEntry =
  | {
      kind: 'file';
      reason?: string;
    }
  | {
      kind: 'url';
      url: string;
    };

export function resolveRendererEntry(options: {
  isPackaged: boolean;
  rendererUrl?: string;
}): RendererEntry {
  const rendererUrl = options.rendererUrl?.trim();

  if (!rendererUrl) {
    return { kind: 'file' };
  }

  if (options.isPackaged) {
    return {
      kind: 'file',
      reason: 'Packaged builds always load the bundled renderer.'
    };
  }

  if (!isAllowedLocalHttpUrl(rendererUrl)) {
    return {
      kind: 'file',
      reason: 'ELECTRON_RENDERER_URL must point to a local development server.'
    };
  }

  return {
    kind: 'url',
    url: normalizeViewerUrl(rendererUrl)
  };
}
