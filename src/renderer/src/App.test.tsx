/// <reference types="node" />

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { DeviceInfo, TaskReport, TestTask } from '../../shared/types';
import { App, DeviceListPanel, ReportPanel, TaskWorkspacePanel, openAllowedViewerUrl } from './App';

const rendererStyles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

function createTask(overrides: Partial<TestTask> = {}): TestTask {
  return {
    id: 'task-1',
    name: 'Login smoke',
    description: 'Validate login',
    status: 'ready',
    input: {
      mode: 'natural_language',
      naturalLanguage: {
        prompt: 'Run login smoke',
        updatedAt: '2026-06-25T02:00:00.000Z'
      },
      blockers: []
    },
    workspacePath: '/tmp/task-1',
    createdAt: '2026-06-25T01:00:00.000Z',
    updatedAt: '2026-06-25T02:00:00.000Z',
    ...overrides
  };
}

describe('viewer open action', () => {
  it('opens only local viewer URLs from the renderer', () => {
    const opener = vi.fn<(url: string, target: string, features: string) => Window | null>();

    expect(openAllowedViewerUrl(' http://127.0.0.1:10000/ ', opener)).toBe(true);
    expect(opener).toHaveBeenCalledWith(
      'http://127.0.0.1:10000/',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('does not trigger an open action for non-local viewer URLs', () => {
    const opener = vi.fn<(url: string, target: string, features: string) => Window | null>();

    expect(openAllowedViewerUrl('https://example.com:10000/', opener)).toBe(false);
    expect(opener).not.toHaveBeenCalled();
  });
});

describe('app shell scrolling', () => {
  it('renders Chinese UI copy by default with a language switcher', () => {
    vi.stubGlobal('window', {
      appAutoTest: undefined,
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn()
      }
    });

    try {
      const html = renderToStaticMarkup(<App />);

      expect(html).toContain('自动化测试工作台');
      expect(html).toContain('创建测试任务');
      expect(html).toContain('上传用例或自然语言');
      expect(html).toContain('中文');
      expect(html).toContain('English');
      expect(html).toContain('刷新');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the persisted English language selection on first render', () => {
    vi.stubGlobal('window', {
      appAutoTest: undefined,
      localStorage: {
        getItem: vi.fn(() => 'en'),
        setItem: vi.fn()
      }
    });

    try {
      const html = renderToStaticMarkup(<App />);

      expect(html).toContain('Automation Workbench');
      expect(html).toContain('Refresh');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders the sidebar beside the dedicated workspace scroll container', () => {
    vi.stubGlobal('window', { appAutoTest: undefined });

    try {
      const html = renderToStaticMarkup(<App />);

      expect(html).toContain('<main class="app-shell">');
      expect(html).toContain('<aside class="sidebar"');
      expect(html).toContain('<section class="workspace">');
      expect(html.indexOf('class="sidebar"')).toBeLessThan(html.indexOf('class="workspace"'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders the user-approved task flow as menu page entries', () => {
    vi.stubGlobal('window', { appAutoTest: undefined });

    try {
      const html = renderToStaticMarkup(<App />);

      expect(html).toContain('aria-label="测试流程"');
      expect(html).toContain('创建测试任务');
      expect(html).toContain('设备');
      expect(html).toContain('上传用例或自然语言');
      expect(html).toContain('执行测试');
      expect(html).toContain('报告');
      expect(html).toContain('data-target-page="task"');
      expect(html).toContain('data-target-page="devices"');
      expect(html).toContain('data-target-page="input"');
      expect(html).toContain('data-target-page="run"');
      expect(html).toContain('data-target-page="report"');
      expect(html.indexOf('class="flow-strip"')).toBeLessThan(
        html.indexOf('class="menu-card-grid"')
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the default home page as a workbench menu instead of one long workflow page', () => {
    vi.stubGlobal('window', { appAutoTest: undefined });

    try {
      const html = renderToStaticMarkup(<App />);

      expect(html).toContain('data-page="overview"');
      expect(html).toContain('class="menu-card-grid"');
      expect(html).toContain('data-target-page="viewer"');
      expect(html).not.toContain('id="task"');
      expect(html).not.toContain('id="devices"');
      expect(html).not.toContain('id="input"');
      expect(html).not.toContain('id="run"');
      expect(html).not.toContain('id="report"');
      expect(html).not.toContain('id="viewer"');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the document fixed and makes the workspace the vertical scroll container', () => {
    expect(rendererStyles).toMatch(/html,\s*body,\s*#root\s*{[^}]*height:\s*100%;/s);
    expect(rendererStyles).toMatch(/body\s*{[^}]*overflow:\s*hidden;/s);
    expect(rendererStyles).toMatch(/\.app-shell\s*{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s);
    expect(rendererStyles).toMatch(/\.sidebar\s*{[^}]*overflow:\s*hidden;/s);
    expect(rendererStyles).toMatch(/\.workspace\s*{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  });

  it('keeps the compact layout inside the fixed app shell instead of body scrolling', () => {
    expect(rendererStyles).toMatch(
      /@media\s*\(max-width:\s*980px\)\s*{[\s\S]*?\.app-shell\s*{[^}]*grid-template-columns:\s*1fr;[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);/s
    );
    expect(rendererStyles).toMatch(/@media\s*\(max-width:\s*640px\)\s*{[\s\S]*?\.workspace\s*{[^}]*padding:\s*16px;/s);
  });
});

describe('workbench panels', () => {
  it('renders the task menu as a list plus selected detail workspace', () => {
    const olderTask = createTask({
      id: 'task-login',
      name: 'Login smoke',
      latestRunId: 'run-login',
      deviceId: 'android-1',
      deviceSnapshot: {
        id: 'android-1',
        name: 'Pixel 8',
        platform: 'android',
        type: 'emulator',
        connected: true
      }
    });
    const selectedTask = createTask({
      id: 'task-checkout',
      name: 'Checkout regression',
      status: 'draft',
      input: {
        mode: 'empty',
        blockers: ['Task input is required before execution.']
      },
      workspacePath: '/tmp/task-checkout',
      createdAt: '2026-06-25T03:00:00.000Z',
      updatedAt: '2026-06-25T03:00:00.000Z'
    });

    const html = renderToStaticMarkup(
      <TaskWorkspacePanel
        currentTask={selectedTask}
        language="en"
        onCreateTask={() => undefined}
        onNavigate={() => undefined}
        onSelectTask={() => undefined}
        onTaskDescriptionChange={() => undefined}
        onTaskNameChange={() => undefined}
        taskAction={{
          status: 'success',
          detail: 'Task task-checkout is draft.'
        }}
        taskDescription=""
        taskName=""
        tasks={[olderTask, selectedTask]}
      />
    );

    expect(html).toContain('class="task-workspace-layout"');
    expect(html).toContain('class="panel task-list-panel"');
    expect(html).toContain('class="panel task-detail-panel"');
    expect(html).toContain('data-task-id="task-login"');
    expect(html).toContain('data-task-id="task-checkout"');
    expect(html).toContain('Checkout regression');
    expect(html).toMatch(/aria-pressed="true"[^>]*data-task-id="task-checkout"/);
    expect(html).toContain('data-page-link="devices"');
    expect(html).toContain('data-page-link="input"');
    expect(html).toContain('data-page-link="run"');
    expect(html).toContain('data-page-link="report"');
    expect(html).not.toContain('run-login');
    expect(html).not.toContain('Pixel 8');
  });

  it('keeps task state partitioned by selected task id in the renderer source', () => {
    expect(appSource).toContain('taskWorkspaceById');
    expect(appSource).toContain('updateTaskWorkspaceState');
    expect(appSource).toContain('selectedTaskId');
    expect(appSource).not.toContain('const [selectedDeviceId, setSelectedDeviceId]');
    expect(appSource).not.toContain('const [prompt, setPrompt]');
    expect(appSource).not.toContain('const [report, setReport]');
  });

  it('keeps the renderer workflow on task-scoped APIs instead of legacy run APIs', () => {
    expect(appSource).toContain('api.tasks.importCase');
    expect(appSource).toContain('api.tasks.start');
    expect(appSource).toContain('api.tasks.cancel');
    expect(appSource).toContain('api.tasks.getReport');
    expect(appSource).toContain('api.tasks.exportReport');
    expect(appSource).not.toMatch(/api\.(cases|runs|reports)\./);
  });

  it('renders disconnected devices as disabled execution targets', () => {
    const devices: DeviceInfo[] = [
      {
        id: 'ios-1',
        name: 'iPhone 16',
        platform: 'ios',
        type: 'simulator',
        connected: false
      }
    ];

    const html = renderToStaticMarkup(
      <DeviceListPanel devices={devices} selectedDeviceId="ios-1" onSelectDevice={() => undefined} />
    );

    expect(html).toContain('No executable devices');
    expect(html).toMatch(/disabled(="")?/);
    expect(html).toContain('disconnected');
  });

  it('renders a local device check entry and start action for disconnected virtual devices', () => {
    const devices: DeviceInfo[] = [
      {
        id: 'android-emulator-1',
        name: 'Pixel 8 API 35',
        platform: 'android',
        type: 'emulator',
        connected: false,
        launchable: true,
        source: 'android-avd',
        state: 'Shutdown'
      } as DeviceInfo,
      {
        id: 'emulator-5554',
        name: 'Offline adb emulator',
        platform: 'android',
        type: 'emulator',
        connected: false,
        launchable: false,
        source: 'adb',
        state: 'offline'
      } as DeviceInfo,
      {
        id: 'ios-physical-1',
        name: 'Jane iPhone',
        platform: 'ios',
        type: 'physical',
        connected: false
      }
    ];

    const html = renderToStaticMarkup(
      <DeviceListPanel
        devices={devices}
        selectedDeviceId=""
        onSelectDevice={() => undefined}
        onCheckDevices={() => undefined}
        onStartDevice={() => undefined}
        deviceAction={{
          status: 'idle',
          detail: 'Local device discovery has not been checked yet.'
        }}
        language="en"
      />
    );

    expect(html).toContain('Check devices');
    expect(html).toContain('Pixel 8 API 35');
    expect(html).toContain('android / emulator');
    expect(html).toContain('Offline adb emulator');
    expect(html).toContain('Start');
    expect(html).toContain('Jane iPhone');
    expect(html).toContain('ios / physical');
    expect(html.match(/>Start</g)).toHaveLength(1);
  });

  it('renders a failed task report with redacted report fields only', () => {
    const report: TaskReport = {
      taskId: 'task-1',
      runId: 'run-1',
      title: 'Smoke report',
      status: 'failed',
      inputMode: 'test_case',
      inputSummary: 'Uploaded test case smoke.yaml (case-1)',
      targetDevice: 'Pixel 8 (android-1, android/emulator)',
      startedAt: '2026-06-12T06:00:00Z',
      endedAt: '2026-06-12T06:00:03Z',
      conclusion: 'Failed',
      failureReason: 'Authorization: [REDACTED] failed for /Users/[REDACTED]/.maestro',
      artifacts: [],
      markdown:
        '# Smoke report\n\n- Status: failed\n- Failure reason: Authorization: [REDACTED] failed for /Users/[REDACTED]/.maestro'
    };

    const html = renderToStaticMarkup(
      <ReportPanel
        report={report}
        exportState={{
          status: 'idle',
          detail: 'Report has not been exported.'
        }}
        onExportMarkdown={() => undefined}
      />
    );

    expect(html).toContain('Smoke report');
    expect(html).toContain('Pixel 8');
    expect(html).toContain('smoke.yaml');
    expect(html).not.toContain('secret-token');
    expect(html).not.toContain('/Users/alice');
    expect(html).toContain('Authorization: [REDACTED] failed for /Users/[REDACTED]/.maestro');
  });

  it('keeps task report secrets out of report HTML and markdown', () => {
    const report: TaskReport = {
      taskId: 'task-2',
      runId: 'run-2',
      title: 'Smoke report',
      status: 'failed',
      inputMode: 'mixed',
      inputSummary: 'Uploaded test case smoke.yaml (case-1) with prompt: token=[REDACTED] from /Users/[REDACTED]/.maestro',
      targetDevice: 'Pixel 8 (android-1, android/emulator)',
      startedAt: '2026-06-12T06:00:00Z',
      endedAt: '2026-06-12T06:00:03Z',
      conclusion: 'Failed',
      failureReason: 'Authorization: [REDACTED] failed for /Users/[REDACTED]/.maestro',
      artifacts: [],
      markdown:
        '# Smoke report\n\n- Prompt: token=[REDACTED] from /Users/[REDACTED]/.maestro\n- Failure reason: Authorization: [REDACTED] failed for /Users/[REDACTED]/.maestro\n- Fallback: api_key=[REDACTED] at /Users/[REDACTED]/.maestro'
    };

    const html = renderToStaticMarkup(
      <ReportPanel
        report={report}
        exportState={{
          status: 'idle',
          detail: 'Report has not been exported.'
        }}
        onExportMarkdown={() => undefined}
      />
    );

    expect(report.markdown).not.toContain('secret-token');
    expect(report.markdown).not.toContain('secret-key');
    expect(report.markdown).not.toContain('/Users/alice');
    expect(html).not.toContain('secret-token');
    expect(html).not.toContain('secret-key');
    expect(html).not.toContain('/Users/alice');
    expect(html).toContain('Authorization: [REDACTED] failed for /Users/[REDACTED]/.maestro');
    expect(html).toContain('api_key=[REDACTED] at /Users/[REDACTED]/.maestro');
  });
});
