export const IPC_CHANNELS = {
  env: {
    getStatus: 'env:get-status'
  },
  devices: {
    list: 'devices:list',
    start: 'devices:start',
    stop: 'devices:stop'
  },
  viewer: {
    getConfig: 'viewer:get-config',
    probe: 'viewer:probe'
  },
  cases: {
    import: 'cases:import'
  },
  runs: {
    start: 'runs:start',
    cancel: 'runs:cancel',
    getStatus: 'runs:get-status'
  },
  reports: {
    get: 'reports:get',
    export: 'reports:export'
  },
  tasks: {
    create: 'tasks:create',
    list: 'tasks:list',
    get: 'tasks:get',
    delete: 'tasks:delete',
    updateInput: 'tasks:update-input',
    importCase: 'tasks:import-case',
    start: 'tasks:start',
    cancel: 'tasks:cancel',
    getReport: 'tasks:get-report',
    exportReport: 'tasks:export-report'
  },
  agent: {
    createSession: 'agent:create-session',
    getModelSettings: 'agent:get-model-settings',
    saveModelSettings: 'agent:save-model-settings',
    sendMessage: 'agent:send-message'
  }
} as const;

type ValueOf<T> = T[keyof T];
type ChannelMap = typeof IPC_CHANNELS;

export type IpcChannel = ValueOf<{
  [Group in keyof ChannelMap]: ValueOf<ChannelMap[Group]>;
}>;
