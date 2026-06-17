/// <reference types="vite/client" />

import type { AppAutoTestApi } from '../../shared/types';

declare global {
  interface Window {
    appAutoTest?: AppAutoTestApi;
  }
}

export {};
