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
    app_default: '本地 Codex 默认',
    blocked: '已阻塞',
    busy: '处理中',
    cancelled: '已取消',
    checking: '检查中',
    codex_config: 'Codex 配置',
    custom: '自定义',
    default: '默认',
    degraded: '部分可用',
    disconnected: '已断开',
    error: '错误',
    failed: '失败',
    idle: '空闲',
    importing: '导入中',
    mixed: '混合输入',
    natural_language: '自然语言',
    not_configured: '未配置',
    preset: '预置',
    queued: '排队中',
    reachable: '可访问',
    ready: '就绪',
    rejected: '已拒绝',
    running: '运行中',
    already_stopped: '已关闭',
    success: '成功',
    succeeded: '成功',
    stopped: '已关闭',
    test_case: '测试用例',
    timeout: '超时',
    unchecked: '未检查',
    unreachable: '不可访问'
  },
  en: {
    app_default: 'local Codex default',
    codex_config: 'Codex config'
  }
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
  'Create a test task before execution.': '请先创建测试任务。',
  'Create a test task before uploading a case.': '请先创建测试任务，再上传用例。',
  'Creating test task.': '正在创建测试任务。',
  'Device start is waiting for Electron main IPC.': '设备开启正在等待 Electron 主进程 IPC 接口。',
  'Directory import is reserved for a follow-up adapter and is not enabled in P0.':
    '目录导入预留给后续适配器，P0 暂未启用。',
  'Enter an Agent instruction.': '请输入 Agent 指令。',
  'Enter a task name.': '请输入任务名称。',
  'Exporting Markdown report.': '正在导出 Markdown 报告。',
  'Import a valid Maestro test case.': '请导入有效的 Maestro 测试用例。',
  'Importing through the task workspace API.': '正在通过任务工作区 API 导入。',
  'Importing through the preload case API.': '正在通过 preload 用例 API 导入。',
  'Local agent adapter is reserved for the next implementation task.':
    '本地 Agent 适配器预留给下一阶段实现。',
  'Loading local Codex model settings.': '正在读取本地 Codex 模型设置。',
  'Codex CLI test executor is not available.': 'Codex CLI 测试执行器不可用。',
  'Codex CLI is not configured. Configure AGENT_PROVIDER=codex and AGENT_COMMAND=codex.':
    '尚未配置 Codex CLI。请配置 AGENT_PROVIDER=codex 和 AGENT_COMMAND=codex。',
  'Codex CLI is not configured for task execution.': 'Codex CLI 尚未配置为任务执行器。',
  'Codex CLI test executor is not available in the browser fallback.':
    '浏览器 fallback 中不可用 Codex CLI 测试执行器。',
  'Codex task execution was cancelled.': 'Codex 任务执行已取消。',
  'Codex CLI and Maestro MCP execution require the Electron main process.':
    'Codex CLI 与 Maestro MCP 执行需要 Electron 主进程。',
  'Codex model settings are still loading.': 'Codex 模型设置仍在加载。',
  'Codex model settings are not configured.': '尚未配置 Codex 模型设置。',
  'Codex model settings saved. New tasks will use the selected model.':
    'Codex 模型设置已保存，新任务会使用所选模型。',
  'Manual-ready Agent mode cannot execute task tests. Configure AGENT_PROVIDER=codex so Codex CLI can call Maestro MCP.':
    'manual-ready Agent 模式不能执行测试任务。请配置 AGENT_PROVIDER=codex，让 Codex CLI 调用 Maestro MCP。',
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
  'Maestro MCP execution requires the Electron main process and Codex CLI.':
    'Maestro MCP 执行需要 Electron 主进程和 Codex CLI。',
  'Markdown report exported.': 'Markdown 报告已导出。',
  'Natural-language flow generated.': '自然语言用例已生成。',
  'Run finished.': '运行已结束。',
  'Run started.': '运行已开始。',
  'Task input updated.': '任务输入已更新。',
  'Task run log deleted.': '任务运行日志已删除。',
  'Test case imported.': '测试用例已导入。',
  'No connected Android or iOS device is available.': '没有可用的已连接 Android 或 iOS 设备。',
  'No connected Android or iOS device is available for this run.':
    '本次运行没有可用的已连接 Android 或 iOS 设备。',
  'No connected Android or iOS device is available in this baseline.':
    '当前基线中没有可用的已连接 Android 或 iOS 设备。',
  'No run has been started.': '尚未开始运行。',
  'Not recorded (legacy run)': '未记录（历史运行）',
  'Not recorded (legacy task)': '未记录（历史任务）',
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
  'Saving Codex model settings.': '正在保存 Codex 模型设置。',
  'Starting the task-scoped local run.': '正在启动任务级本地运行。',
  'Supported formats: .yaml, .yml.': '支持格式：.yaml、.yml。',
  'Supported formats: .yaml, .yml. Maximum size: 25 MB.': '支持格式：.yaml、.yml。最大 25 MB。',
  'Task import did not produce a test case.': '任务导入未生成测试用例。',
  'Task input is required before execution.': '执行前需要配置任务输入。',
  'Task report generation requires the Electron main process.':
    '任务报告生成需要 Electron 主进程。',
  'Task-scoped imports require the Electron main process.':
    '任务级导入需要 Electron 主进程。',
  'Task execution requires the Electron main process.': '任务执行需要 Electron 主进程。',
  'Task has not been created.': '尚未创建测试任务。',
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
  return STATUS_LABELS[language][status] ?? status.replace(/_/g, ' ');
}

function localizeKnownDynamicText(value: string, language: Language): string | null {
  if (language === 'en') {
    return null;
  }

  const dynamicRules: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^Agent command "(.+)" is installed, but no message transport is configured\. Auto-launch is disabled\.$/, (match) => `Agent 命令 "${match[1]}" 已安装，但尚未配置消息传输，已禁用自动启动。`],
    [/^Agent command "(.+)" is unavailable: (.+)$/, (match) => `Agent 命令 "${match[1]}" 不可用：${match[2]}`],
    [/^Codex CLI command "(.+)" is installed\. Task execution will be delegated to Codex, which should call Maestro MCP\.$/, (match) => `Codex CLI 命令 "${match[1]}" 已安装。测试执行会委托给 Codex，并由 Codex 调用 Maestro MCP。`],
    [/^Codex CLI command "(.+)" is unavailable: (.+)$/, (match) => `Codex CLI 命令 "${match[1]}" 不可用：${match[2]}`],
    [/^Codex model (.+) is active for new tasks\.$/, (match) => `Codex 模型 ${match[1]} 将用于新任务。`],
    [/^Cancelling (.+)\.$/, (match) => `正在取消 ${match[1]}。`],
    [/^Direct MCP calls are not available inside the desktop client; CLI fallback is available \((.+)\)\.$/, (match) => `桌面客户端内不可直接调用 MCP；CLI fallback 可用（${match[1]}）。`],
    [/^Direct MCP calls are not available inside the desktop client; CLI fallback command is configured \((.+)\)\.$/, (match) => `桌面客户端内不可直接调用 MCP；CLI fallback 命令已配置（${match[1]}）。`],
    [/^File is larger than (.+) MB\.$/, (match) => `文件超过 ${match[1]} MB。`],
    [/^Found (\d+) supported device\(s\): (\d+) connected, (\d+) virtual, (\d+) physical\.$/, (match) => `发现 ${match[1]} 台受支持设备：${match[2]} 台已连接，${match[3]} 台虚拟设备，${match[4]} 台真机。`],
    [/^Last refreshed (.+)\.$/, (match) => `上次刷新：${match[1]}。`],
    [/^Maestro CLI is available \((.+)\)\.$/, (match) => `Maestro CLI 可用（${match[1]}）。`],
    [/^Maestro CLI command is configured \((.+)\)\. Version check is skipped until execution\.$/, (match) => `Maestro CLI 命令已配置（${match[1]}）。版本检查已延后到执行时。`],
    [/^Maestro MCP execution is delegated to Codex CLI\. Local Maestro CLI is not used for task execution\.$/, () => 'Maestro MCP 执行已委托给 Codex CLI。本地 Maestro CLI 不用于任务执行。'],
    [/^Maestro MCP\/CLI is unavailable: (.+)$/, (match) => `Maestro MCP/CLI 不可用：${match[1]}`],
    [/^Markdown exported to (.+)\.$/, (match) => `Markdown 已导出到 ${match[1]}。`],
    [/^Ready for (.+)\.$/, (match) => `已准备好在 ${match[1]} 上运行。`],
    [/^Starting (.+)\.$/, (match) => `正在开启 ${match[1]}。`],
    [/^Stopping (.+)\.$/, (match) => `正在关闭 ${match[1]}。`],
    [/^Stopped Android virtual device "(.+)"\.$/, (match) => `已关闭 Android 虚拟设备“${match[1]}”。`],
    [/^Stopped iOS simulator "(.+)"\.$/, (match) => `已关闭 iOS 模拟器“${match[1]}”。`],
    [/^Failed to stop Android virtual device "(.+)": (.+)$/, (match) => `关闭 Android 虚拟设备“${match[1]}”失败：${match[2]}`],
    [/^Failed to stop iOS simulator "(.+)": (.+)$/, (match) => `关闭 iOS 模拟器“${match[1]}”失败：${match[2]}`],
    [/^(.+) cannot be started from the desktop client\.$/, (match) => `${match[1]} 不能从桌面客户端开启。`],
    [/^(.+) cannot be stopped from the desktop client\.$/, (match) => `${match[1]} 不能从桌面客户端关闭。`],
    [/^(.+) is already disconnected\.$/, (match) => `${match[1]} 已断开连接。`],
    [/^(.+) is already shut down\.$/, (match) => `${match[1]} 已关闭。`],
    [/^Device (.+) start returned (.+)\.$/, (match) => `设备 ${match[1]} 开启返回：${localizeStatus(match[2], language)}。`],
    [/^Device (.+) stop returned (.+)\.$/, (match) => `设备 ${match[1]} 关闭返回：${localizeStatus(match[2], language)}。`],
    [/^Run (.+) did not reach (.+)\.$/, (match) => `运行 ${match[1]} 未达到 ${match[2]}。`],
    [/^Run (.+) finished as (.+)\.$/, (match) => `运行 ${match[1]} 已结束，状态：${localizeStatus(match[2], language)}。`],
    [/^Run (.+) is (.+)\.$/, (match) => `运行 ${match[1]} 当前状态：${localizeStatus(match[2], language)}。`],
    [/^Run (.+) was not found\.$/, (match) => `未找到运行 ${match[1]}。`],
    [/^Task (.+) has already been started\.$/, (match) => `任务 ${match[1]} 已经开始。`],
    [/^Task (.+) is already (.+)\.$/, (match) => `任务 ${match[1]} 已经是 ${localizeStatus(match[2], language)} 状态。`],
    [/^Task (.+) finished as (.+)\.$/, (match) => `任务 ${match[1]} 已结束，状态：${localizeStatus(match[2], language)}。`],
    [/^Task (.+) is (.+)\.$/, (match) => `任务 ${match[1]} 当前状态：${localizeStatus(match[2], language)}。`],
    [/^This task keeps (.+)\. New model settings apply only to new tasks\.$/, (match) => `此任务继续使用 ${match[1]}。新的模型设置只影响新任务。`],
    [/^Task (.+) created\.$/, (match) => `任务 ${match[1]} 已创建。`],
    [/^Test case (.+) was not found\.$/, (match) => `未找到测试用例 ${match[1]}。`],
    [/^Test case is (.+); max upload size is (.+)\.$/, (match) => `测试用例大小为 ${match[1]}，上传上限为 ${match[2]}。`],
    [/^Test case source was not found: (.+)$/, (match) => `未找到测试用例源文件：${match[1]}`],
    [/^Test report for (.+)$/, (match) => `测试报告：${match[1]}`],
    [/^Viewer responded with HTTP (\d+)\.$/, (match) => `Viewer 返回 HTTP ${match[1]}。`],
    [/^Viewer responded with HTTP (\d+) (.+)$/, (match) => `Viewer 返回 HTTP ${match[1]} ${match[2]}`],
    [/^(.+) case imported into (.+)\.$/, (match) => `${match[1]} 用例已导入到 ${match[2]}。`],
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
      brand: 'Auto Test Desktop',
      subtitle: '应用自动化测试',
      title: '应用自动化测试',
      description: '管理测试任务、设备和本地运行环境'
    },
    nav: {
      overview: '仪表盘',
      task: '测试任务',
      viewer: 'Viewer',
      devices: '设备管理',
      settings: '设置',
      input: '输入',
      run: '执行',
      report: '报告'
    },
    actions: {
      cancel: '取消',
      checkDevices: '检查设备',
      createTask: '创建任务',
      deleteLog: '删除日志',
      deleteTask: '删除任务',
      export: '导出',
      newTask: '新建任务',
      open: '打开',
      probe: '探测',
      refresh: '刷新',
      retest: '重新测试',
      save: '保存',
      startDevice: '开启',
      stopDevice: '关闭',
      startRun: '开始运行'
    },
    titles: {
      agent: 'Agent',
      agentTrigger: 'Agent 触发',
      createTask: '创建测试任务',
      currentTask: '当前任务',
      devices: '设备选择',
      deviceManagement: '设备管理',
      executeTest: '执行测试',
      executionLogHistory: '执行日志历史',
      functionalReport: '功能测试报告',
      liveExecutionLog: '实时执行日志',
      maestro: 'Maestro',
      modelSettings: 'Codex 模型设置',
      report: '报告',
      runStatus: '运行状态',
      taskDetailWorkspace: '详情工作区',
      taskInput: '上传用例或自然语言',
      taskList: '任务列表',
      taskLogs: '任务日志',
      testFlow: '测试流程',
      testCase: '测试用例',
      viewer: 'Viewer',
      viewerUrl: 'Viewer URL'
    },
    dashboard: {
      blocked: '阻塞',
      devices: '已连接设备',
      label: '仪表盘数据',
      latestReport: '最近任务',
      ready: '就绪',
      readyToRun: '环境已满足启动条件',
      runtime: '运行就绪',
      tasks: '测试任务',
      tasksDetail: (active: number, finished: number) =>
        `${active} 个执行中，${finished} 个已完成或结束`
    },
    empty: {
      noExecutableDevicesTitle: '没有可执行设备',
      noExecutableDevicesDetail: '在 Maestro 返回 connected=true 前，Android 和 iOS 执行保持禁用。',
      noReportTitle: '暂无报告',
      noReportDetail: '本地运行时接受运行后会生成报告。',
      noSelectedTaskTitle: '未选择任务',
      noSelectedTaskDetail: '从左侧任务列表选择一个任务，或先创建新的测试任务。',
      noTaskLogsTitle: '暂无任务日志',
      noTaskLogsDetail: '创建、输入、测试和报告导出记录会显示在这里。',
      noTaskRunDetails: '该次运行暂无详细记录。',
      noTasksTitle: '暂无测试任务',
      noTasksDetail: '创建第一个任务后，它会出现在任务列表中。',
      waitingRunTitle: '等待运行',
      waitingRunDetail: '环境、设备、用例或指令检查未通过时，开始按钮会保持禁用。'
    },
    fields: {
      case: '用例',
      created: '创建时间',
      description: '描述',
      device: '设备',
      devices: '设备',
      duration: '耗时',
      format: '格式',
      generated: '生成时间',
      imported: '导入时间',
      input: '输入',
      localTarget: '本地地址',
      model: 'Codex 模型',
      name: '名称',
      preset: '预置',
      run: '运行',
      source: '来源',
      status: '状态',
      task: '任务',
      target: '目标',
      targetAppId: '目标 App ID',
      updated: '更新时间'
    },
    copy: {
      createTaskFirst: '任务创建后，才能继续选择设备、配置输入并执行测试。',
      customModelLabel: '自定义模型',
      defaultCaseLabel: '选择 Maestro YAML',
      inputHelp: '上传 Maestro YAML 或填写自然语言指令；两者都会交给 Codex 通过 Maestro MCP 执行。',
      deleteRunLogConfirm: (runId: string) => `确认删除运行 ${runId} 的执行日志？功能测试报告和任务记录会保留。`,
      deleteTaskConfirm: (name: string) => `确认删除测试任务“${name}”？该操作会移除任务工作区数据。`,
      modelNamePlaceholder: '例如 gpt-5',
      modelSettingsHelp: '默认选项读取本地 Codex 配置；保存后的覆盖只影响新建任务，已创建任务继续使用自己的模型快照。',
      naturalLanguageLabel: '自然语言',
      promptPlaceholder: '在所选设备上运行已上传的冒烟 flow',
      promptOnlyLimit: '自然语言会直接交给 Codex 执行；目标 App ID 可选，但填写后会作为启动上下文传入。',
      targetAppIdPlaceholder: '例如 com.example.app',
      requirementHint: '需求端口：9999。当前 Maestro 提示：10000。',
      taskDescriptionPlaceholder: '例如：验证登录主流程、覆盖关键失败态',
      taskNamePlaceholder: '例如：登录冒烟测试',
      uploadLabel: '上传用例',
      viewerUrlMustBeLocal: 'Viewer URL 必须指向 localhost、127.0.0.1 或 ::1。'
    },
    titlesAttr: {
      cancelRun: '取消运行',
      checkDevices: '检查本地设备',
      deleteRunLog: '删除这次运行的执行日志',
      deleteRunningTask: '运行中的任务不能删除',
      deleteTask: '删除测试任务',
      exportMarkdown: '导出 Markdown 报告',
      openLocalViewer: '打开本地 Viewer',
      probeViewer: '探测 Viewer',
      refreshRuntime: '刷新运行时',
      startVirtualDevice: '开启虚拟设备',
      stopVirtualDevice: '关闭虚拟设备',
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
      notSelected: '未选择',
      notStarted: '未开始',
      runRecordCount: (count: number) => `${count} 条详细记录`,
      runSummary: (runId: string) => `运行 ${runId}`,
      selectedDevice: '所选设备',
      noTask: '未创建任务'
    },
    model: {
      customOption: '自定义',
      legacyRun: '未记录（历史运行）',
      legacyTask: '未记录（历史任务）'
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
        model: 'Codex 模型',
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
      brand: 'Auto Test Desktop',
      subtitle: 'App automation',
      title: 'App Automation',
      description: 'Manage test tasks, devices, and the local runtime'
    },
    nav: {
      overview: 'Dashboard',
      task: 'Test Tasks',
      viewer: 'Viewer',
      devices: 'Device Management',
      settings: 'Settings',
      input: 'Input',
      run: 'Run',
      report: 'Report'
    },
    actions: {
      cancel: 'Cancel',
      checkDevices: 'Check devices',
      createTask: 'Create Task',
      deleteLog: 'Delete log',
      deleteTask: 'Delete task',
      export: 'Export',
      newTask: 'New Task',
      open: 'Open',
      probe: 'Probe',
      refresh: 'Refresh',
      retest: 'Retest',
      save: 'Save',
      startDevice: 'Start',
      stopDevice: 'Stop',
      startRun: 'Start Run'
    },
    titles: {
      agent: 'Agent',
      agentTrigger: 'Agent Trigger',
      createTask: 'Create Test Task',
      currentTask: 'Current Task',
      devices: 'Device Selection',
      deviceManagement: 'Device Management',
      executeTest: 'Execute Test',
      executionLogHistory: 'Execution Log History',
      functionalReport: 'Functional Test Report',
      liveExecutionLog: 'Live Execution Log',
      maestro: 'Maestro',
      modelSettings: 'Codex Model Settings',
      report: 'Report',
      runStatus: 'Run Status',
      taskDetailWorkspace: 'Detail Workspace',
      taskInput: 'Upload Case or Natural Language',
      taskList: 'Task List',
      taskLogs: 'Task Logs',
      testFlow: 'Test Flow',
      testCase: 'Test Case',
      viewer: 'Viewer',
      viewerUrl: 'Viewer URL'
    },
    dashboard: {
      blocked: 'Blocked',
      devices: 'Connected Devices',
      label: 'Dashboard metrics',
      latestReport: 'Latest Task',
      ready: 'Ready',
      readyToRun: 'Environment is ready to start runs',
      runtime: 'Runtime Readiness',
      tasks: 'Test Tasks',
      tasksDetail: (active: number, finished: number) =>
        `${active} active, ${finished} finished or closed`
    },
    empty: {
      noExecutableDevicesTitle: 'No executable devices',
      noExecutableDevicesDetail: 'Android and iOS execution remains disabled until Maestro reports connected=true.',
      noReportTitle: 'No report yet',
      noReportDetail: 'A report appears after the local runtime accepts a run.',
      noSelectedTaskTitle: 'No task selected',
      noSelectedTaskDetail: 'Select a task from the task list or create a new test task first.',
      noTaskLogsTitle: 'No task logs yet',
      noTaskLogsDetail: 'Creation, input, test, and report export records appear here.',
      noTaskRunDetails: 'No detailed records for this run yet.',
      noTasksTitle: 'No test tasks',
      noTasksDetail: 'Created tasks appear in this list.',
      waitingRunTitle: 'Waiting for a run',
      waitingRunDetail: 'Start remains disabled while environment, device, case, or prompt checks fail.'
    },
    fields: {
      case: 'Case',
      created: 'Created',
      description: 'Description',
      device: 'Device',
      devices: 'Devices',
      duration: 'Duration',
      format: 'Format',
      generated: 'Generated',
      imported: 'Imported',
      input: 'Input',
      localTarget: 'Local target',
      model: 'Codex model',
      name: 'Name',
      preset: 'Preset',
      run: 'Run',
      source: 'Source',
      status: 'Status',
      task: 'Task',
      target: 'Target',
      targetAppId: 'Target App ID',
      updated: 'Updated'
    },
    copy: {
      createTaskFirst: 'Create the task before selecting a device, configuring input, and executing the test.',
      customModelLabel: 'Custom model',
      defaultCaseLabel: 'Select Maestro YAML',
      inputHelp: 'Upload a Maestro YAML file or enter a natural-language instruction. Both are delegated to Codex through Maestro MCP.',
      deleteRunLogConfirm: (runId: string) => `Delete execution log for run ${runId}? The functional report and task record stay available.`,
      deleteTaskConfirm: (name: string) => `Delete test task "${name}"? This removes its task workspace data.`,
      modelNamePlaceholder: 'Example: gpt-5',
      modelSettingsHelp: 'Reads the default model from local Codex configuration. Saved overrides apply only to new tasks. Existing tasks keep their own model snapshot.',
      naturalLanguageLabel: 'Natural language',
      promptPlaceholder: 'Run the uploaded smoke flow on the selected device',
      promptOnlyLimit: 'Prompt-only execution is delegated directly to Codex. Target App ID is optional and passed as launch context when present.',
      targetAppIdPlaceholder: 'Example: com.example.app',
      requirementHint: 'Requirement: 9999. Current Maestro hint: 10000.',
      taskDescriptionPlaceholder: 'Example: validate the login happy path and key failure states',
      taskNamePlaceholder: 'Example: Login smoke test',
      uploadLabel: 'Upload case',
      viewerUrlMustBeLocal: 'Viewer URL must point to localhost, 127.0.0.1, or ::1.'
    },
    titlesAttr: {
      cancelRun: 'Cancel run',
      checkDevices: 'Check local devices',
      deleteRunLog: 'Delete this run execution log',
      deleteRunningTask: 'Running tasks cannot be deleted',
      deleteTask: 'Delete test task',
      exportMarkdown: 'Export Markdown report',
      openLocalViewer: 'Open local viewer',
      probeViewer: 'Probe viewer',
      refreshRuntime: 'Refresh runtime',
      startVirtualDevice: 'Start virtual device',
      stopVirtualDevice: 'Stop virtual device',
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
      notSelected: 'Not selected',
      notStarted: 'not started',
      runRecordCount: (count: number) => `${count} detail record${count === 1 ? '' : 's'}`,
      runSummary: (runId: string) => `Run ${runId}`,
      selectedDevice: 'selected device',
      noTask: 'No task created'
    },
    model: {
      customOption: 'Custom',
      legacyRun: 'Not recorded (legacy run)',
      legacyTask: 'Not recorded (legacy task)'
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
        model: 'Codex model',
        prompt: 'Prompt',
        run: 'Run',
        status: 'Status',
        target: 'Target'
      }
    }
  }
} as const;
