import { isAllowedLocalViewerUrl } from '../shared/viewerConfig';

export type WindowOpenDetails = {
  url: string;
};

export type WindowOpenDecision = {
  action: 'allow' | 'deny';
};

export function decideViewerWindowOpen(url: string): WindowOpenDecision {
  return {
    action: isAllowedLocalViewerUrl(url) ? 'allow' : 'deny'
  };
}

export function createViewerWindowOpenHandler(): (
  details: WindowOpenDetails
) => WindowOpenDecision {
  return ({ url }) => decideViewerWindowOpen(url);
}
