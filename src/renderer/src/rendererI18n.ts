import type { ViewerConfigSource } from '../../shared/types';

export type Language = 'zh' | 'en';

export const DEFAULT_LANGUAGE: Language = 'zh';
export const LANGUAGE_STORAGE_KEY = 'app-auto-test.language';

export const DATE_LOCALES: Record<Language, string> = {
  zh: 'zh-CN',
  en: 'en-US'
};

const SUPPORTED_LANGUAGES = new Set<Language>(['zh', 'en']);

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

export function isLanguage(value: string | null | undefined): value is Language {
  return SUPPORTED_LANGUAGES.has(value as Language);
}

function getReadableStorage(storage?: ReadableStorage): ReadableStorage | undefined {
  if (storage) {
    return storage;
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.localStorage;
}

function getWritableStorage(storage?: WritableStorage): WritableStorage | undefined {
  if (storage) {
    return storage;
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.localStorage;
}

export function readStoredLanguage(storage?: ReadableStorage): Language {
  try {
    const value = getReadableStorage(storage)?.getItem(LANGUAGE_STORAGE_KEY);

    return isLanguage(value) ? value : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function persistLanguage(language: Language, storage?: WritableStorage): void {
  try {
    getWritableStorage(storage)?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // A locked-down webview should not block the renderer from using the in-memory setting.
  }
}

const STATUS_LABELS: Record<Language, Record<string, string>> = {
  zh: {
    accepted: '已接受',
    blocked: '已阻塞',
    busy: '处理中',
    cancelled: '已取消',
    checking: '检查中',
    default: '默认',
    degraded: '部分可用',
    disconnected: '已断开',
    error: '错误',
    failed: '失败',
    idle: '空闲',
    importing: '导入中',
    not_configured: '未配置',
    queued: '排队中',
    reachable: '可访问',
    ready: '就绪',
    rejected: '已拒绝',
    running: '运行中',
    success: '成功',
    succeeded: '成功',
    timeout: '超时',
    unchecked: '未检查',
    unreachable: '不可访问'
  },
  en: {}
};

const EXACT_ZH: Record<string, string> = {
  'Agent command is installed, but no message transport is configured.':
    'Agent 命令已安装，但尚未配置消息传输。',
  'Blocked before execution': '执行前已阻塞',
  'Browser fallback cannot poll local runs.': '浏览器 fallback 不能轮询本地运行。',
  'Browser fallback cannot reach local agents.': '浏览器 fallback 不能访问本地 Agent。',
  'Browser fallback cannot start local runs.': '浏览器 fallback 不能启动本地运行。',
  'Browser fallback report': '浏览器 fallback 报告',
  'Checking local viewer target.': '正在检查本地 Viewer 地址。',
  'Checking Android/iOS physical and virtual devices.': '正在检查 Android/iOS 真机与虚拟设备。',
  'Configured but not probed in the skeleton baseline.': '已配置，但骨架基线中尚未探测。',
  'Device start is waiting for Electron main IPC.': '设备开启正在等待 Electron 主进程 IPC 接口。',
  'Directory import is reserved for a follow-up adapter and is not enabled in P0.':
    '目录导入预留给后续适配器，P0 暂未启用。',
  'Enter an Agent instruction.': '请输入 Agent 指令。',
  'Exporting Markdown report.': '正在导出 Markdown 报告。',
  'Import a valid Maestro test case.': '请导入有效的 Maestro 测试用例。',
  'Importing through the preload case API.': '正在通过 preload 用例 API 导入。',
  'Local agent adapter is reserved for the next implementation task.':
    '本地 Agent 适配器预留给下一阶段实现。',
  'Local agent command detection is available, but P0 does not auto-launch Codex/Cursor or open a message transport.':
    '已支持本地 Agent 命令检测，但 P0 不会自动启动 Codex/Cursor，也不会打开消息传输。',
  'Local agent command is not configured. The desktop client will not auto-launch Codex or Cursor.':
    '尚未配置本地 Agent 命令，桌面客户端不会自动启动 Codex 或 Cursor。',
  'Local agent confirmation is not available.': '本地 Agent 确认不可用。',
  'Local device discovery has not been checked yet.': '尚未检查本地设备。',
  'Local target accepted by the renderer fallback.': 'renderer fallback 已接受本地地址。',
  'Local viewer reachability has not been checked in this session.': '本次会话尚未检查本地 Viewer 可达性。',
  'Loading runtime status.': '正在加载运行时状态。',
  'Maestro and local agent adapters are pending follow-up implementation.':
    'Maestro 与本地 Agent 适配器待后续实现。',
  'Maestro flow was cancelled.': 'Maestro flow 已取消。',
  'Maestro provider is disabled by configuration.': 'Maestro provider 已被配置禁用。',
  'Maestro provider is not available.': 'Maestro provider 不可用。',
  'Maestro provider is not wired in this baseline.': '当前基线尚未接入 Maestro provider。',
  'Markdown report exported.': 'Markdown 报告已导出。',
  'No connected Android or iOS device is available.': '没有可用的已连接 Android 或 iOS 设备。',
  'No connected Android or iOS device is available for this run.':
    '本次运行没有可用的已连接 Android 或 iOS 设备。',
  'No connected Android or iOS device is available in this baseline.':
    '当前基线中没有可用的已连接 Android 或 iOS 设备。',
  'No run has been started.': '尚未开始运行。',
  'Pending': '待定',
  'Refresh runtime': '刷新运行时',
  'Refreshing local runtime status.': '正在刷新本地运行时状态。',
  'Report export requires the Electron main process.': '报告导出需要 Electron 主进程。',
  'Report generation requires the Electron main process.': '报告生成需要 Electron 主进程。',
  'Report has not been exported.': '报告尚未导出。',
  'Run accepted by the local runtime.': '本地运行时已接受运行。',
  'Run cancelled by user before Maestro execution started.': '用户在 Maestro 执行开始前取消了运行。',
  'Run cancelled by user. Underlying Maestro process termination signal sent.':
    '用户已取消运行，并已向底层 Maestro 进程发送终止信号。',
  'Run execution failed.': '运行执行失败。',
  'Run status polling timed out before the local runtime reached a terminal state.':
    '本地运行时到达终态前，运行状态轮询已超时。',
  'Runtime status has not been refreshed yet.': '尚未刷新运行时状态。',
  'Runtime status is still loading.': '正在加载运行时状态。',
  'Select a connected Android or iOS device.': '请选择已连接的 Android 或 iOS 设备。',
  'Selected device is not connected for execution.': '所选设备未连接，无法执行。',
  'Sending Agent instruction and starting the local run.': '正在发送 Agent 指令并启动本地运行。',
  'Supported formats: .yaml, .yml.': '支持格式：.yaml、.yml。',
  'Supported formats: .yaml, .yml. Maximum size: 25 MB.': '支持格式：.yaml、.yml。最大 25 MB。',
  'Test case source was not found.': '未找到测试用例源文件。',
  'The selected file is empty.': '所选文件为空。',
  'Unexpected local runtime error.': '本地运行时出现异常。',
  'Viewer URL is configured and constrained to a local target.':
    'Viewer URL 已配置，并限制为本地地址。',
  'Viewer URL is not allowed.': '不允许使用该 Viewer URL。',
  'Viewer URL must point to localhost, 127.0.0.1, or ::1.':
    'Viewer URL 必须指向 localhost、127.0.0.1 或 ::1。',
  'Viewer target is unreachable.': 'Viewer 地址不可访问。',
  'YAML test case is empty.': 'YAML 测试用例为空。',
  'Zip test cases are not enabled in P0. Upload a .yaml or .yml Maestro flow.':
    'P0 暂未启用 zip 测试用例，请上传 .yaml 或 .yml Maestro flow。'
};

function localizeStatus(status: string, language: Language): string {
  if (language === 'en') {
    return status.replace(/_/g, ' ');
  }

  return STATUS_LABELS.zh[status] ?? status.replace(/_/g, ' ');
}

function localizeKnownDynamicText(value: string, language: Language): string | null {
  if (language === 'en') {
    return null;
  }

  const dynamicRules: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^Agent command "(.+)" is installed, but no message transport is configured\. Auto-launch is disabled\.$/, (match) => `Agent 命令 "${match[1]}" 已安装，但尚未配置消息传输，已禁用自动启动。`],
    [/^Agent command "(.+)" is unavailable: (.+)$/, (match) => `Agent 命令 "${match[1]}" 不可用：${match[2]}`],
    [/^Cancelling (.+)\.$/, (match) => `正在取消 ${match[1]}。`],
    [/^Direct MCP calls are not available inside the desktop client; CLI fallback is available \((.+)\)\.$/, (match) => `桌面客户端内不可直接调用 MCP；CLI fallback 可用（${match[1]}）。`],
    [/^File is larger than (.+) MB\.$/, (match) => `文件超过 ${match[1]} MB。`],
    [/^Found (\d+) supported device\(s\): (\d+) connected, (\d+) virtual, (\d+) physical\.$/, (match) => `发现 ${match[1]} 台受支持设备：${match[2]} 台已连接，${match[3]} 台虚拟设备，${match[4]} 台真机。`],
    [/^Last refreshed (.+)\.$/, (match) => `上次刷新：${match[1]}。`],
    [/^Maestro CLI is available \((.+)\)\.$/, (match) => `Maestro CLI 可用（${match[1]}）。`],
    [/^Maestro MCP\/CLI is unavailable: (.+)$/, (match) => `Maestro MCP/CLI 不可用：${match[1]}`],
    [/^Markdown exported to (.+)\.$/, (match) => `Markdown 已导出到 ${match[1]}。`],
    [/^Ready for (.+)\.$/, (match) => `已准备好在 ${match[1]} 上运行。`],
    [/^Starting (.+)\.$/, (match) => `正在开启 ${match[1]}。`],
    [/^(.+) cannot be started from the desktop client\.$/, (match) => `${match[1]} 不能从桌面客户端开启。`],
    [/^Device (.+) start returned (.+)\.$/, (match) => `设备 ${match[1]} 开启返回：${localizeStatus(match[2], language)}。`],
    [/^Run (.+) did not reach (.+)\.$/, (match) => `运行 ${match[1]} 未达到 ${match[2]}。`],
    [/^Run (.+) finished as (.+)\.$/, (match) => `运行 ${match[1]} 已结束，状态：${localizeStatus(match[2], language)}。`],
    [/^Run (.+) is (.+)\.$/, (match) => `运行 ${match[1]} 当前状态：${localizeStatus(match[2], language)}。`],
    [/^Run (.+) was not found\.$/, (match) => `未找到运行 ${match[1]}。`],
    [/^Test case (.+) was not found\.$/, (match) => `未找到测试用例 ${match[1]}。`],
    [/^Test case is (.+); max upload size is (.+)\.$/, (match) => `测试用例大小为 ${match[1]}，上传上限为 ${match[2]}。`],
    [/^Test case source was not found: (.+)$/, (match) => `未找到测试用例源文件：${match[1]}`],
    [/^Test report for (.+)$/, (match) => `测试报告：${match[1]}`],
    [/^Viewer responded with HTTP (\d+)\.$/, (match) => `Viewer 返回 HTTP ${match[1]}。`],
    [/^Viewer responded with HTTP (\d+) (.+)$/, (match) => `Viewer 返回 HTTP ${match[1]} ${match[2]}`],
    [/^(.+) case imported\.$/, (match) => `${match[1]} 用例已导入。`]
  ];

  for (const [pattern, formatter] of dynamicRules) {
    const match = value.match(pattern);

    if (match) {
      return formatter(match);
    }
  }

  return null;
}

export function localizeText(value: string, language: Language): string {
  if (language === 'en') {
    return value;
  }

  return EXACT_ZH[value] ?? localizeKnownDynamicText(value, language) ?? value;
}

export function getStatusLabel(status: string, language: Language): string {
  return localizeStatus(status, language);
}

export function getViewerSourceLabel(source: ViewerConfigSource, language: Language): string {
  if (language === 'en') {
    return source;
  }

  return source === 'env' ? '环境变量' : '默认';
}

export const COPY = {
  zh: {
    language: {
      label: '语言',
      zh: '中文',
      en: 'English'
    },
    shell: {
      navigationLabel: '工作区导航',
      brand: 'App Auto Test',
      subtitle: 'P0 工作台',
      eyebrow: 'QSC-23',
      title: '自动化测试工作台'
    },
    nav: {
      overview: '概览',
      viewer: 'Viewer',
      devices: '设备',
      cases: '用例',
      report: '报告'
    },
    actions: {
      cancel: '取消',
      checkDevices: '检查设备',
      export: '导出',
      open: '打开',
      probe: '探测',
      refresh: '刷新',
      startDevice: '开启',
      startRun: '开始运行'
    },
    titles: {
      agent: 'Agent',
      agentTrigger: 'Agent 触发',
      devices: '设备',
      maestro: 'Maestro',
      report: '报告',
      runStatus: '运行状态',
      testCase: '测试用例',
      viewer: 'Viewer',
      viewerUrl: 'Viewer URL'
    },
    empty: {
      noExecutableDevicesTitle: '没有可执行设备',
      noExecutableDevicesDetail: '在 Maestro 返回 connected=true 前，Android 和 iOS 执行保持禁用。',
      noReportTitle: '暂无报告',
      noReportDetail: '本地运行时接受运行后会生成报告。',
      waitingRunTitle: '等待运行',
      waitingRunDetail: '环境、设备、用例或指令检查未通过时，开始按钮会保持禁用。'
    },
    fields: {
      case: '用例',
      device: '设备',
      devices: '设备',
      duration: '耗时',
      format: '格式',
      generated: '生成时间',
      imported: '导入时间',
      localTarget: '本地地址',
      run: '运行',
      target: '目标',
      updated: '更新时间'
    },
    copy: {
      defaultCaseLabel: '选择 Maestro YAML',
      promptPlaceholder: '在所选设备上运行已上传的冒烟 flow',
      requirementHint: '需求端口：9999。当前 Maestro 提示：10000。',
      viewerUrlMustBeLocal: 'Viewer URL 必须指向 localhost、127.0.0.1 或 ::1。'
    },
    titlesAttr: {
      cancelRun: '取消运行',
      checkDevices: '检查本地设备',
      exportMarkdown: '导出 Markdown 报告',
      openLocalViewer: '打开本地 Viewer',
      probeViewer: '探测 Viewer',
      refreshRuntime: '刷新运行时',
      startVirtualDevice: '开启虚拟设备',
      viewerUrlMustBeLocal: 'Viewer URL 必须是本地地址'
    },
    runtime: {
      deviceInspectionSummary: (
        totalSupported: number,
        connected: number,
        virtual: number,
        physical: number
      ) => `发现 ${totalSupported} 台受支持设备：${connected} 台已连接，${virtual} 台虚拟设备，${physical} 台真机`,
      generated: (value: string) => `生成时间：${value}`,
      session: (value: string) => `会话：${value}`,
      executableDevices: (count: number) => `${count} 台可执行设备`,
      viewerConfig: (source: ViewerConfigSource, url: string) =>
        `${getViewerSourceLabel(source, 'zh')} URL：${url}`,
      viewerConfigLoading: '正在加载 Viewer 配置',
      notLoaded: '未加载',
      notStarted: '未开始',
      selectedDevice: '所选设备'
    },
    roles: {
      assistant: '助手',
      system: '系统',
      user: '用户'
    },
    report: {
      page: '页面',
      markdown: 'Markdown',
      fallbackTitle: '浏览器 fallback 报告',
      placeholderTitle: (caseName: string) => `测试报告：${caseName}`,
      markdownHeading: '测试报告',
      markdownLabels: {
        case: '用例',
        duration: '耗时',
        failure: '失败原因',
        prompt: '指令',
        run: '运行',
        status: '状态',
        target: '目标'
      }
    }
  },
  en: {
    language: {
      label: 'Language',
      zh: '中文',
      en: 'English'
    },
    shell: {
      navigationLabel: 'Workspace navigation',
      brand: 'App Auto Test',
      subtitle: 'P0 workbench',
      eyebrow: 'QSC-23',
      title: 'Automation Workbench'
    },
    nav: {
      overview: 'Overview',
      viewer: 'Viewer',
      devices: 'Devices',
      cases: 'Cases',
      report: 'Report'
    },
    actions: {
      cancel: 'Cancel',
      checkDevices: 'Check devices',
      export: 'Export',
      open: 'Open',
      probe: 'Probe',
      refresh: 'Refresh',
      startDevice: 'Start',
      startRun: 'Start Run'
    },
    titles: {
      agent: 'Agent',
      agentTrigger: 'Agent Trigger',
      devices: 'Devices',
      maestro: 'Maestro',
      report: 'Report',
      runStatus: 'Run Status',
      testCase: 'Test Case',
      viewer: 'Viewer',
      viewerUrl: 'Viewer URL'
    },
    empty: {
      noExecutableDevicesTitle: 'No executable devices',
      noExecutableDevicesDetail: 'Android and iOS execution remains disabled until Maestro reports connected=true.',
      noReportTitle: 'No report yet',
      noReportDetail: 'A report appears after the local runtime accepts a run.',
      waitingRunTitle: 'Waiting for a run',
      waitingRunDetail: 'Start remains disabled while environment, device, case, or prompt checks fail.'
    },
    fields: {
      case: 'Case',
      device: 'Device',
      devices: 'Devices',
      duration: 'Duration',
      format: 'Format',
      generated: 'Generated',
      imported: 'Imported',
      localTarget: 'Local target',
      run: 'Run',
      target: 'Target',
      updated: 'Updated'
    },
    copy: {
      defaultCaseLabel: 'Select Maestro YAML',
      promptPlaceholder: 'Run the uploaded smoke flow on the selected device',
      requirementHint: 'Requirement: 9999. Current Maestro hint: 10000.',
      viewerUrlMustBeLocal: 'Viewer URL must point to localhost, 127.0.0.1, or ::1.'
    },
    titlesAttr: {
      cancelRun: 'Cancel run',
      checkDevices: 'Check local devices',
      exportMarkdown: 'Export Markdown report',
      openLocalViewer: 'Open local viewer',
      probeViewer: 'Probe viewer',
      refreshRuntime: 'Refresh runtime',
      startVirtualDevice: 'Start virtual device',
      viewerUrlMustBeLocal: 'Viewer URL must be local'
    },
    runtime: {
      deviceInspectionSummary: (
        totalSupported: number,
        connected: number,
        virtual: number,
        physical: number
      ) => `Found ${totalSupported} supported device(s): ${connected} connected, ${virtual} virtual, ${physical} physical`,
      generated: (value: string) => `Generated: ${value}`,
      session: (value: string) => `Session: ${value}`,
      executableDevices: (count: number) => `${count} executable device(s)`,
      viewerConfig: (source: ViewerConfigSource, url: string) => `${source} URL: ${url}`,
      viewerConfigLoading: 'Loading viewer config',
      notLoaded: 'Not loaded',
      notStarted: 'not started',
      selectedDevice: 'selected device'
    },
    roles: {
      assistant: 'assistant',
      system: 'system',
      user: 'user'
    },
    report: {
      page: 'Page',
      markdown: 'Markdown',
      fallbackTitle: 'Browser fallback report',
      placeholderTitle: (caseName: string) => `Test report for ${caseName}`,
      markdownHeading: 'Test report',
      markdownLabels: {
        case: 'Case',
        duration: 'Duration',
        failure: 'Failure',
        prompt: 'Prompt',
        run: 'Run',
        status: 'Status',
        target: 'Target'
      }
    }
  }
} as const;
