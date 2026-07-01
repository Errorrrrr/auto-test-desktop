/// <reference types="node" />

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CodexModelSettingsResponse, DeviceInfo, TaskReport, TestTask } from '../../shared/types';
import {
  App,
  createModelSettingsSaveRequest,
  DeviceListPanel,
  getModelSettingsDraftPresetId,
  ModelSettingsPanel,
  ReportPanel,
  TaskWorkspacePanel,
  openAllowedViewerUrl
} from './App';

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

const modelSettings: CodexModelSettingsResponse = {
  defaultModelName: 'gpt-5',
  effective: {
    capturedAt: '2026-06-29T07:00:00Z',
    modelName: 'gpt-5',
    presetId: 'gpt-5',
    source: 'preset'
  },
  presets: [
    {
      id: 'gpt-5',
      label: 'GPT-5',
      modelName: 'gpt-5'
    },
    {
      id: 'gpt-5-mini',
      label: 'GPT-5 mini',
      modelName: 'gpt-5-mini'
    }
  ],
  settings: {
    modelName: 'gpt-5',
    presetId: 'gpt-5',
    source: 'preset',
    updatedAt: '2026-06-29T06:00:00Z'
  }
};

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

      expect(html).toContain('Auto Test Desktop');
      expect(html).toContain('应用自动化测试');
      expect(html).toContain('管理测试任务、设备和本地运行环境');
      expect(html).not.toContain('QSC-23');
      expect(html).toContain('仪表盘');
      expect(html).toContain('测试任务');
      expect(html).toContain('设备管理');
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

      expect(html).toContain('Auto Test Desktop');
      expect(html).toContain('App Automation');
      expect(html).toContain('Manage test tasks, devices, and the local runtime');
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

  it('renders the durable left navigation as dashboard, task list, device management, viewer, and settings', () => {
    vi.stubGlobal('window', { appAutoTest: undefined });

    try {
      const html = renderToStaticMarkup(<App />);

      expect(html).toContain('data-target-page="overview"');
      expect(html).toContain('data-target-page="task"');
      expect(html).toContain('data-target-page="devices"');
      expect(html).toContain('data-target-page="viewer"');
      expect(html).toContain('data-target-page="settings"');
      expect(html).toContain('仪表盘');
      expect(html).toContain('测试任务');
      expect(html).toContain('设备管理');
      expect(html).toContain('设置');
      expect(html).not.toContain('aria-label="测试流程"');
      expect(html).not.toContain('data-target-page="input"');
      expect(html).not.toContain('data-target-page="run"');
      expect(html).not.toContain('data-target-page="report"');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders Codex model settings from the strict response contract', () => {
    const settings: CodexModelSettingsResponse = {
      defaultModelName: 'gpt-5',
      settings: {
        modelName: 'gpt-5-mini',
        source: 'preset',
        presetId: 'gpt-5-mini',
        updatedAt: '2026-06-29T08:00:00.000Z'
      },
      effective: {
        modelName: 'gpt-5-mini',
        source: 'preset',
        presetId: 'gpt-5-mini',
        capturedAt: '2026-06-29T08:01:00.000Z',
        settingsUpdatedAt: '2026-06-29T08:00:00.000Z'
      },
      presets: [
        {
          id: 'gpt-5',
          label: 'GPT-5',
          modelName: 'gpt-5',
          recommended: true
        },
        {
          id: 'gpt-5-mini',
          label: 'GPT-5 mini',
          modelName: 'gpt-5-mini'
        }
      ]
    };

    const html = renderToStaticMarkup(
      <ModelSettingsPanel
        draftModelName="gpt-5-mini"
        draftPresetId="gpt-5-mini"
        language="en"
        modelSettings={settings}
        onDraftModelNameChange={() => undefined}
        onDraftPresetChange={() => undefined}
        onSave={() => undefined}
        saveState={{
          status: 'idle',
          detail: ''
        }}
      />
    );

    expect(html).toContain('data-page="settings"');
    expect(html).toContain('Codex Model Settings');
    expect(html).toContain('gpt-5-mini (GPT-5 mini)');
    expect(html).toContain('local Codex default (gpt-5)');
    expect(html).toContain('GPT-5 mini (gpt-5-mini)');
  });

  it('keeps the default home page as a dashboard instead of a workflow menu page', () => {
    vi.stubGlobal('window', { appAutoTest: undefined });

    try {
      const html = renderToStaticMarkup(<App />);

      expect(html).toContain('data-page="overview"');
      expect(html).toContain('class="dashboard-grid"');
      expect(html).toContain('data-dashboard-metric="tasks-total"');
      expect(html).toContain('data-dashboard-metric="devices-connected"');
      expect(html).toContain('data-dashboard-metric="latest-report"');
      expect(html).not.toContain('class="menu-card-grid"');
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
  it('renders the Codex model settings panel with presets and save state', () => {
    const html = renderToStaticMarkup(
      <ModelSettingsPanel
        draftModelName="gpt-5-mini"
        draftPresetId="gpt-5-mini"
        language="en"
        modelSettings={modelSettings}
        onDraftModelNameChange={() => undefined}
        onDraftPresetChange={() => undefined}
        onSave={() => undefined}
        saveState={{
          status: 'success',
          detail: 'Codex model settings saved. New tasks will use the selected model.'
        }}
      />
    );

    expect(html).toContain('data-page="settings"');
    expect(html).toContain('Codex Model Settings');
    expect(html).toContain('Saved overrides apply only to new tasks');
    expect(html).toContain('local Codex default (gpt-5)');
    expect(html).toContain('GPT-5 mini (gpt-5-mini)');
    expect(html).toContain('value="gpt-5-mini" selected=""');
    expect(html).toContain('Codex model settings saved');
  });

  it('labels the app default as the local Codex default model', () => {
    const html = renderToStaticMarkup(
      <ModelSettingsPanel
        draftModelName="o3"
        draftPresetId="__app_default__"
        language="en"
        modelSettings={{
          defaultModelName: 'o3',
          effective: {
            capturedAt: '2026-06-30T04:00:00Z',
            modelName: 'o3',
            source: 'app_default'
          },
          presets: modelSettings.presets
        }}
        onDraftModelNameChange={() => undefined}
        onDraftPresetChange={() => undefined}
        onSave={() => undefined}
        saveState={{
          status: 'idle',
          detail: ''
        }}
      />
    );

    expect(html).toContain('o3 (local Codex default)');
    expect(html).toContain('local Codex default (o3)');
    expect(html).toContain('Reads the default model from local Codex configuration');
  });

  it('renders local Codex config models as selectable options', () => {
    const settings: CodexModelSettingsResponse = {
      defaultModelName: 'o3',
      effective: {
        capturedAt: '2026-06-30T04:00:00Z',
        modelName: 'o3',
        source: 'codex_config'
      },
      presets: modelSettings.presets,
      codexConfig: {
        path: '/Users/example/.codex/config.toml',
        status: 'loaded',
        activeProfile: 'work',
        defaultModelName: 'o3',
        modelOptions: [
          {
            id: 'default',
            label: 'Codex default',
            modelName: 'o3',
            source: 'config_default'
          },
          {
            id: 'profile-work',
            label: 'Work profile',
            modelName: 'gpt-5-codex',
            profileName: 'work',
            source: 'profile'
          }
        ]
      }
    };

    const html = renderToStaticMarkup(
      <ModelSettingsPanel
        draftModelName="o3"
        draftPresetId="__app_default__"
        language="en"
        modelSettings={settings}
        onDraftModelNameChange={() => undefined}
        onDraftPresetChange={() => undefined}
        onSave={() => undefined}
        saveState={{
          status: 'idle',
          detail: ''
        }}
      />
    );

    expect(html).toContain('o3 (Codex config)');
    expect(html).toContain('local Codex default (o3)');
    expect(html).not.toContain('Codex default (o3)</option><option value="__codex_config__:default"');
    expect(html).toContain('Work profile (gpt-5-codex)');
  });

  it('disables model controls while local Codex settings are loading', () => {
    const html = renderToStaticMarkup(
      <ModelSettingsPanel
        draftModelName="gpt-5"
        draftPresetId="__app_default__"
        language="en"
        modelSettings={null}
        onDraftModelNameChange={() => undefined}
        onDraftPresetChange={() => undefined}
        onSave={() => undefined}
        saveState={{
          status: 'busy',
          detail: 'Loading local Codex model settings.'
        }}
      />
    );

    expect(html).toContain('Loading local Codex model settings.');
    expect(html).toMatch(/id="codex-model-preset"[^>]*disabled=""/);
    expect(html).toMatch(/id="codex-model-name"[^>]*disabled=""/);
    expect(html).toMatch(/<button class="primary-button" disabled="" type="submit">/);
  });

  it('keeps model controls disabled when local Codex settings fail to load', () => {
    const html = renderToStaticMarkup(
      <ModelSettingsPanel
        draftModelName="gpt-5"
        draftPresetId="__app_default__"
        language="en"
        modelSettings={null}
        onDraftModelNameChange={() => undefined}
        onDraftPresetChange={() => undefined}
        onSave={() => undefined}
        saveState={{
          status: 'error',
          detail: 'Unable to read local Codex configuration.'
        }}
      />
    );

    expect(html).toContain('class="validation-message"');
    expect(html).toContain('Unable to read local Codex configuration.');
    expect(html).toMatch(/id="codex-model-preset"[^>]*disabled=""/);
    expect(html).toMatch(/id="codex-model-name"[^>]*disabled=""/);
    expect(html).toMatch(/<button class="primary-button" disabled="" type="submit">/);
  });

  it('maps local Codex config selections to codex_config save requests', () => {
    const settings: CodexModelSettingsResponse = {
      defaultModelName: 'o3',
      effective: {
        capturedAt: '2026-06-30T04:00:00Z',
        modelName: 'gpt-5-codex',
        source: 'codex_config'
      },
      presets: modelSettings.presets,
      settings: {
        modelName: 'gpt-5-codex',
        source: 'codex_config',
        updatedAt: '2026-06-30T04:00:00Z'
      },
      codexConfig: {
        path: '/Users/example/.codex/config.toml',
        status: 'loaded',
        defaultModelName: 'o3',
        modelOptions: [
          {
            id: 'profile-work',
            label: 'Work profile',
            modelName: 'gpt-5-codex',
            profileName: 'work',
            source: 'profile'
          }
        ]
      }
    };
    const draftPresetId = getModelSettingsDraftPresetId(settings);

    expect(draftPresetId).toBe('__codex_config__:profile-work');
    expect(createModelSettingsSaveRequest(settings, draftPresetId, 'ignored')).toEqual({
      modelName: 'gpt-5-codex',
      source: 'codex_config'
    });
  });

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
      updatedAt: '2026-06-25T03:00:00.000Z',
      modelSnapshot: {
        modelName: 'gpt-5-mini',
        source: 'preset',
        presetId: 'gpt-5-mini',
        capturedAt: '2026-06-25T03:00:00.000Z'
      }
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
    expect(html).toContain('data-task-detail-section="devices"');
    expect(html).toContain('data-task-detail-section="input"');
    expect(html).toContain('data-task-detail-section="progress"');
    expect(html).toContain('data-task-detail-section="logs"');
    expect(html).toContain('data-task-detail-section="report"');
    expect(html).toContain('Target App ID');
    expect(html).toContain('Codex model');
    expect(html).toContain('gpt-5-mini (GPT-5 mini)');
    expect(html).toContain('data-task-id="task-login"');
    expect(html).toContain('data-task-id="task-checkout"');
    expect(html).toContain('Checkout regression');
    expect(html).toMatch(/aria-pressed="true"[^>]*data-task-id="task-checkout"/);
    expect(html).toContain('Delete task');
    expect(html).not.toContain('data-page-link="devices"');
    expect(html).not.toContain('data-page-link="input"');
    expect(html).not.toContain('data-page-link="run"');
    expect(html).not.toContain('data-page-link="report"');
    expect(html).not.toContain('run-login');
    expect(html).not.toContain('Pixel 8');
  });

  it('shows the task model snapshot and warns when global settings changed', () => {
    const selectedTask = createTask({
      id: 'task-old-model',
      name: 'Old model task',
      modelSnapshot: {
        capturedAt: '2026-06-29T07:00:00Z',
        modelName: 'gpt-5-mini',
        presetId: 'gpt-5-mini',
        source: 'preset'
      }
    });

    const html = renderToStaticMarkup(
      <TaskWorkspacePanel
        currentTask={selectedTask}
        language="en"
        modelSettings={modelSettings}
        onCreateTask={() => undefined}
        onSelectTask={() => undefined}
        onTaskDescriptionChange={() => undefined}
        onTaskNameChange={() => undefined}
        taskAction={{
          status: 'success',
          detail: 'Task task-old-model is ready.'
        }}
        taskDescription=""
        taskName=""
        tasks={[selectedTask]}
      />
    );

    expect(html).toContain('Codex model');
    expect(html).toContain('gpt-5-mini (GPT-5 mini)');
    expect(html).toContain('This task keeps gpt-5-mini. New model settings apply only to new tasks.');
  });

  it('renders task logs as per-run summaries with expandable details', () => {
    const selectedTask = createTask({
      id: 'task-history',
      name: 'History task',
      status: 'succeeded',
      targetAppId: 'com.example.history',
      latestRunId: 'run-2',
      runIds: ['run-1', 'run-2'],
      logs: [
        {
          id: 'log-run-1-start',
          kind: 'run_started',
          message: 'Run started.',
          createdAt: '2026-06-25T02:00:00.000Z',
          runId: 'run-1',
          status: 'queued'
        },
        {
          id: 'log-start',
          kind: 'run_started',
          message: 'Run started.',
          createdAt: '2026-06-25T03:00:00.000Z',
          runId: 'run-2',
          status: 'queued'
        },
        {
          id: 'log-report',
          kind: 'report_generated',
          message: 'Markdown report exported.',
          createdAt: '2026-06-25T03:05:00.000Z',
          runId: 'run-2',
          reportPath: '/tmp/task-history/reports/task-history.md',
          status: 'succeeded'
        }
      ]
    });

    const html = renderToStaticMarkup(
      <TaskWorkspacePanel
        currentTask={selectedTask}
        language="en"
        onCreateTask={() => undefined}
        onSelectTask={() => undefined}
        onTaskDescriptionChange={() => undefined}
        onTaskNameChange={() => undefined}
        taskAction={{
          status: 'success',
          detail: 'Task task-history is succeeded.'
        }}
        taskDescription=""
        taskName=""
        targetAppId="com.example.history"
        tasks={[selectedTask]}
      />
    );

    expect(html).toContain('data-task-detail-section="logs"');
    expect(html).toContain('Task Logs');
    expect(html).toContain('Retest');
    expect(html).toContain('value="com.example.history"');
    expect(html).toContain('class="task-run-log-list"');
    expect(html).not.toContain('class="task-log-list"');
    expect(html.match(/data-task-run-log-id=/g)).toHaveLength(2);
    expect(html).toContain('data-task-run-log-id="run-2"');
    expect(html).toContain('Run run-2');
    expect(html).toContain('2 detail records');
    expect(html).toContain('data-task-run-log-id="run-1"');
    expect(html).toContain('Run run-1');
    expect(html).toContain('1 detail record');
    expect(html).toMatch(/<details class="task-run-log-details"><summary/);
    expect(html).toContain('Run started.');
    expect(html).toContain('Markdown report exported.');
    expect(html).toContain('run-2');
    expect(html).toContain('/tmp/task-history/reports/task-history.md');
  });

  it('separates progress, live execution logs, deletable log history, and the functional report', () => {
    const selectedTask = createTask({
      id: 'task-live',
      name: 'Live task',
      status: 'running',
      targetAppId: 'com.example.live',
      latestRunId: 'run-live',
      runIds: ['run-live'],
      startedAt: '2026-06-25T03:00:00.000Z',
      updatedAt: '2026-06-25T03:01:00.000Z',
      logs: [
        {
          id: 'log-live-start',
          kind: 'run_started',
          message: 'Run started.',
          createdAt: '2026-06-25T03:00:00.000Z',
          runId: 'run-live',
          status: 'queued'
        },
        {
          id: 'log-live-progress',
          kind: 'input_updated',
          message: 'Codex is checking the login button.',
          createdAt: '2026-06-25T03:01:00.000Z',
          runId: 'run-live',
          status: 'running'
        }
      ]
    });
    const report: TaskReport = {
      taskId: selectedTask.id,
      runId: 'run-live',
      title: 'Login functional report',
      status: 'running',
      inputMode: 'natural_language',
      inputSummary: 'Prompt: login smoke',
      targetDevice: 'Pixel 8 (android-1, android/emulator)',
      startedAt: '2026-06-25T03:00:00.000Z',
      endedAt: '2026-06-25T03:01:00.000Z',
      conclusion: 'Running functional verification',
      modelSummary: 'gpt-5 (local Codex default)',
      artifacts: [],
      markdown: '# Functional test report\n\n- Scenario: Login smoke'
    };

    const html = renderToStaticMarkup(
      <TaskWorkspacePanel
        currentTask={selectedTask}
        language="en"
        onCreateTask={() => undefined}
        onDeleteTaskLog={() => undefined}
        onSelectTask={() => undefined}
        onTaskDescriptionChange={() => undefined}
        onTaskNameChange={() => undefined}
        report={report}
        taskAction={{
          status: 'success',
          detail: 'Task task-live is running.'
        }}
        taskDescription=""
        taskName=""
        tasks={[selectedTask]}
      />
    );

    expect(html).toContain('data-task-detail-section="progress"');
    expect(html).toContain('data-task-progress-value="75"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('Device');
    expect(html).toContain('Input');
    expect(html).toContain('Execute');
    expect(html).toContain('Report');
    expect(html).toContain('data-task-detail-section="live-log"');
    expect(html).toContain('Live Execution Log');
    expect(html).toContain('Codex is checking the login button.');
    expect(html).toContain('data-task-detail-section="logs"');
    expect(html).toContain('Execution Log History');
    expect(html).toContain('data-delete-task-log-run-id="run-live"');
    expect(html).toContain('Delete log');
    expect(html).toContain('data-task-detail-section="report"');
    expect(html).toContain('Functional Test Report');
    expect(html).toContain('Login functional report');
    expect(html).toContain('# Functional test report');
  });

  it('renders task device selection as a compact dropdown inside task details', () => {
    const selectedTask = createTask({
      id: 'task-device-compact',
      name: 'Device compact layout'
    });
    const devices: DeviceInfo[] = [
      {
        id: 'ios-1',
        name: 'iPhone 16',
        platform: 'ios',
        type: 'simulator',
        connected: true
      },
      {
        id: 'android-avd-1',
        name: 'Pixel 8 API 35',
        platform: 'android',
        type: 'emulator',
        connected: false,
        launchable: true
      } as DeviceInfo,
      {
        id: 'web-1',
        name: 'Chrome',
        platform: 'web',
        type: 'unknown',
        connected: true
      } as DeviceInfo
    ];

    const html = renderToStaticMarkup(
      <TaskWorkspacePanel
        currentTask={selectedTask}
        deviceAction={{
          status: 'success',
          detail: 'Found 2 supported device(s): 1 connected, 2 virtual, 0 physical.'
        }}
        devices={devices}
        language="en"
        onCheckDevices={() => undefined}
        onCreateTask={() => undefined}
        onNavigate={() => undefined}
        onSelectDevice={() => undefined}
        onSelectTask={() => undefined}
        onStartDevice={() => undefined}
        onTaskDescriptionChange={() => undefined}
        onTaskNameChange={() => undefined}
        selectedDeviceId="ios-1"
        taskAction={{
          status: 'success',
          detail: 'Task task-device-compact is ready.'
        }}
        taskDescription=""
        taskName=""
        tasks={[selectedTask]}
      />
    );

    expect(html).toContain('data-task-detail-section="devices"');
    expect(html).toContain('class="device-panel compact-device-panel"');
    expect(html).toContain('class="compact-device-control"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="device-select-trigger"');
    expect(html).toContain('class="device-picker-menu" hidden=""');
    expect(html).toContain('<div class="device-picker-heading">Android</div>');
    expect(html).toContain('<div class="device-picker-heading">iOS</div>');
    expect(html).toContain('<div class="device-picker-heading">Web</div>');
    expect(html).toContain('class="device-picker-option-item selected"');
    expect(html).toContain('iPhone 16');
    expect(html).toContain('Chrome');
    expect(html).toContain('<small>Web</small>');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('class="device-list"');
    expect(html.match(/Found 2 supported device\(s\): 1 connected, 2 virtual, 0 physical/g)).toHaveLength(1);
  });

  it('positions the compact device picker as an overlay instead of page layout content', () => {
    expect(rendererStyles).toMatch(/\.compact-device-control\s*{[^}]*position:\s*relative;[^}]*z-index:\s*30;/s);
    expect(rendererStyles).toMatch(
      /\.device-picker-menu\s*{[^}]*position:\s*absolute;[^}]*top:\s*calc\(100%\s*\+\s*8px\);[^}]*z-index:\s*40;/s
    );
    expect(rendererStyles).toMatch(/\.device-picker-menu\[hidden\]\s*{[^}]*display:\s*none;/s);
  });

  it('keeps task state partitioned by selected task id in the renderer source', () => {
    expect(appSource).toContain('taskWorkspaceById');
    expect(appSource).toContain('updateTaskWorkspaceState');
    expect(appSource).toContain('selectedTaskId');
    expect(appSource).not.toContain('const [selectedDeviceId, setSelectedDeviceId]');
    expect(appSource).not.toContain('const [prompt, setPrompt]');
    expect(appSource).not.toContain('const [report, setReport]');
  });

  it('keeps device management actions from mutating task-scoped device selection', () => {
    const devicesPage = appSource.match(/\{activePage === 'devices' \? \([\s\S]*?\{activePage === 'viewer'/)?.[0] ?? '';

    expect(devicesPage).toContain('onCheckDevices={() => void handleManageCheckDevices()}');
    expect(devicesPage).toContain('onStartDevice={(device) => void handleManageStartDevice(device)}');
    expect(devicesPage).toContain('onStopDevice={(device) => void handleManageStopDevice(device)}');
    expect(devicesPage).not.toContain('handleCheckDevices()');
    expect(devicesPage).not.toContain('handleStartDevice(device)');
    expect(devicesPage).not.toContain('handleStopDevice(device)');
  });

  it('keeps the latest task dashboard card on latest task data only', () => {
    const latestTaskMetric = appSource.match(/detail: latestTask[\s\S]*?value:[^\n]+/)?.[0] ?? '';

    expect(latestTaskMetric).toContain('detail: latestTask ? latestTask.name');
    expect(latestTaskMetric).toContain("status: latestTask?.status ?? 'idle'");
    expect(latestTaskMetric).toContain("value: formatStatusLabel(latestTask?.status ?? 'idle', language)");
    expect(latestTaskMetric).not.toContain('report?.status');
    expect(latestTaskMetric).not.toContain('report ?');
  });

  it('keeps the renderer workflow on task-scoped APIs instead of legacy run APIs', () => {
    expect(appSource).toContain('api.tasks.importCase');
    expect(appSource).toContain('api.tasks.start');
    expect(appSource).toContain('api.tasks.cancel');
    expect(appSource).toContain('api.tasks.delete');
    expect(appSource).toContain('api.tasks.getReport');
    expect(appSource).toContain('api.tasks.exportReport');
    expect(appSource).not.toMatch(/api\.(cases|runs|reports)\./);
  });

  it('keeps task polling long enough for Codex and Maestro MCP runs to reach backend timeout', () => {
    expect(appSource).toContain('const RUN_STATUS_POLL_TIMEOUT_MS = 10 * 60_000;');
    expect(appSource).toContain('Date.now() - startedPollingAt < RUN_STATUS_POLL_TIMEOUT_MS');
    expect(appSource).not.toContain('const RUN_STATUS_MAX_POLLS = 120;');
  });

  it('keeps renderer model settings on the strict shared/preload response contract', () => {
    expect(appSource).toContain('CodexModelSettingsResponse');
    expect(appSource).toContain('api.agent.getModelSettings()');
    expect(appSource).toContain('api.agent.saveModelSettings');
    expect(appSource).toContain('modelSettings');
    expect(appSource).not.toContain('CodexModelSettingsState');
    expect(appSource).not.toContain("source: 'legacy'");
    expect(appSource).not.toContain("source: 'env'");
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
        name: 'Medium Phone',
        platform: 'android',
        type: 'emulator',
        connected: true,
        launchable: false,
        source: 'adb',
        state: 'device'
      } as DeviceInfo,
      {
        id: 'emulator-5556',
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
        onStopDevice={() => undefined}
        deviceAction={{
          status: 'idle',
          detail: 'Local device discovery has not been checked yet.'
        }}
        language="en"
      />
    );

    expect(html).toContain('Check devices');
    expect(html).toContain('Pixel 8 API 35');
    expect(html).toContain('Android / Shutdown');
    expect(html).toContain('Medium Phone');
    expect(html).toContain('Android / device');
    expect(html).toContain('Offline adb emulator');
    expect(html).toContain('Android / offline');
    expect(html).toContain('Start');
    expect(html).toContain('Stop');
    expect(html).toContain('Jane iPhone');
    expect(html).toContain('iOS / physical');
    expect(html.match(/>Start</g)).toHaveLength(1);
    expect(html.match(/>Stop</g)).toHaveLength(1);
  });

  it('does not duplicate device inspection summary in device management', () => {
    const devices: DeviceInfo[] = [
      {
        id: 'ios-1',
        name: 'iPhone 16',
        platform: 'ios',
        type: 'simulator',
        connected: true
      },
      {
        id: 'android-avd-1',
        name: 'Pixel 8 API 35',
        platform: 'android',
        type: 'emulator',
        connected: false,
        launchable: true
      } as DeviceInfo,
      {
        id: 'web-1',
        name: 'Chrome',
        platform: 'web',
        type: 'unknown',
        connected: true
      } as DeviceInfo
    ];

    const html = renderToStaticMarkup(
      <DeviceListPanel
        devices={devices}
        deviceAction={{
          status: 'success',
          detail: 'Found 2 supported device(s): 1 connected, 2 virtual, 0 physical.'
        }}
        language="en"
        selectionMode="manage"
      />
    );

    expect(html).toContain('Device Management');
    expect(html).toContain('<span>Android</span><small>1</small>');
    expect(html).toContain('<span>iOS</span><small>1</small>');
    expect(html).toContain('<span>Web</span><small>1</small>');
    expect(html).toContain('Chrome');
    expect(html.match(/Found 2 supported device\(s\): 1 connected, 2 virtual, 0 physical/g)).toHaveLength(1);
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
      modelSummary: 'gpt-5 (app default)',
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
    expect(html).toContain('gpt-5 (app default)');
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
      modelSummary: 'gpt-5 (app default)',
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
