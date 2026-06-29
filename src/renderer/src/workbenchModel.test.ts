import { describe, expect, it } from 'vitest';

import type {
  DeviceInfo,
  DeviceStartResult,
  DeviceStopResult,
  EnvironmentStatus,
  TestCaseManifest,
  TestTask,
  TestRun
} from '../../shared/types';
import {
  createInitialUploadState,
  createCaseImportRequest,
  buildTaskRunLogSummaries,
  createReportPlaceholder,
  formatStatusLabel,
  getCurrentTaskAfterRefresh,
  getDeviceInspectionSummary,
  getPreferredDeviceId,
  getRunActionStatusForTaskStatus,
  getRunReadiness,
  getSelectedTaskAfterRefresh,
  hasStartedDeviceAppeared,
  isStartableDevice,
  isStoppableDevice,
  isVirtualDevice,
  mapDeviceStartResultToAction,
  mapDeviceStopResultToAction,
  mapViewerProbeResult,
  upsertTaskList,
  validateCaseFile,
  validateViewerUrl
} from './workbenchModel';
import { localizeText } from './rendererI18n';

const connectedDevice: DeviceInfo = {
  id: 'android-1',
  name: 'Pixel 8',
  platform: 'android',
  type: 'emulator',
  connected: true
};

const disconnectedDevice: DeviceInfo = {
  id: 'ios-1',
  name: 'iPhone 16',
  platform: 'ios',
  type: 'simulator',
  connected: false
};

const launchableSimulator = {
  ...disconnectedDevice,
  launchable: true,
  source: 'simctl',
  state: 'Shutdown'
} as DeviceInfo;

const offlineAdbEmulator = {
  id: 'emulator-5554',
  name: 'Pixel offline',
  platform: 'android',
  type: 'emulator',
  connected: false,
  launchable: false,
  source: 'adb',
  state: 'offline'
} as DeviceInfo;

const disconnectedPhysicalDevice: DeviceInfo = {
  id: 'ios-physical-1',
  name: 'Jane iPhone',
  platform: 'ios',
  type: 'physical',
  connected: false
};

const importedCase: TestCaseManifest = {
  id: 'case-1',
  name: 'smoke.yaml',
  sourcePath: 'smoke.yaml',
  format: 'yaml',
  importedAt: '2026-06-12T06:00:00Z',
  status: 'imported',
  validationMessages: []
};

function createTask(overrides: Partial<TestTask> = {}): TestTask {
  return {
    id: 'task-1',
    name: 'Smoke task',
    status: 'ready',
    input: {
      mode: 'test_case',
      testCase: {
        caseId: importedCase.id,
        name: importedCase.name,
        storedPath: importedCase.storedPath ?? importedCase.sourcePath,
        format: importedCase.format,
        source: 'uploaded',
        importedAt: importedCase.importedAt
      },
      blockers: []
    },
    workspacePath: '/tmp/tasks/task-1',
    createdAt: '2026-06-12T06:00:00Z',
    updatedAt: '2026-06-12T06:00:00Z',
    ...overrides
  };
}

function createEnvironment(overrides: Partial<EnvironmentStatus> = {}): EnvironmentStatus {
  return {
    generatedAt: '2026-06-12T06:00:00Z',
    agent: {
      status: 'ready',
      label: 'Agent',
      detail: 'Ready'
    },
    maestro: {
      status: 'ready',
      label: 'Maestro',
      detail: 'Ready'
    },
    viewer: {
      status: 'ready',
      label: 'Viewer',
      detail: 'Ready',
      url: 'http://127.0.0.1:10000/',
      source: 'default'
    },
    canStartRun: true,
    blockers: [],
    capabilities: {
      uploads: ['.yaml', '.yml'],
      reports: ['page', 'markdown'],
      execution: 'ready'
    },
    ...overrides
  };
}

describe('workbench run readiness', () => {
  it('keeps queued and running run actions busy until the task reaches a terminal status', () => {
    expect(getRunActionStatusForTaskStatus('queued')).toBe('busy');
    expect(getRunActionStatusForTaskStatus('running')).toBe('busy');
    expect(getRunActionStatusForTaskStatus('succeeded')).toBe('success');
    expect(getRunActionStatusForTaskStatus('failed')).toBe('error');
    expect(getRunActionStatusForTaskStatus('blocked')).toBe('error');
  });

  it('blocks execution until a test task exists', () => {
    const readiness = getRunReadiness({
      environment: createEnvironment(),
      devices: [connectedDevice],
      selectedDeviceId: connectedDevice.id,
      task: null,
      prompt: 'Generate a login smoke flow'
    });

    expect(readiness.canStart).toBe(false);
    expect(readiness.reasons).toContain('Create a test task before execution.');
    expect(readiness.inputMode).toBe('natural_language');
  });

  it('blocks runs when no connected Android or iOS device is selected', () => {
    const readiness = getRunReadiness({
      environment: createEnvironment({
        canStartRun: false,
        blockers: ['No connected Android or iOS device is available.'],
        capabilities: {
          uploads: ['.yaml', '.yml'],
          reports: ['page', 'markdown'],
          execution: 'mock_disabled'
        }
      }),
      devices: [disconnectedDevice],
      selectedDeviceId: disconnectedDevice.id,
      task: createTask(),
      prompt: 'Run smoke'
    });

    expect(readiness.canStart).toBe(false);
    expect(readiness.reasons).toContain('Selected device is not connected for execution.');
    expect(readiness.reasons).not.toContain('No connected Android or iOS device is available.');
  });

  it('blocks uploaded task runs when the Codex executor is unavailable', () => {
    const readiness = getRunReadiness({
      environment: createEnvironment({
        agent: {
          status: 'not_configured',
          label: 'Agent',
          detail: 'Codex CLI test executor is not available.'
        },
        canStartRun: false,
        blockers: ['Codex CLI test executor is not available.'],
        capabilities: {
          uploads: ['.yaml', '.yml'],
          reports: ['page', 'markdown'],
          execution: 'mock_disabled'
        }
      }),
      devices: [connectedDevice],
      selectedDeviceId: connectedDevice.id,
      task: createTask(),
      prompt: ''
    });

    expect(readiness.canStart).toBe(false);
    expect(readiness.reasons).toEqual(['Codex CLI test executor is not available.']);
    expect(readiness.selectedDevice).toEqual(connectedDevice);
    expect(readiness.inputMode).toBe('test_case');
  });

  it('allows natural-language runs without a target app id because Codex executes them through MCP', () => {
    const readiness = getRunReadiness({
      environment: createEnvironment(),
      devices: [connectedDevice],
      selectedDeviceId: connectedDevice.id,
      task: createTask({
        input: {
          mode: 'natural_language',
          naturalLanguage: {
            prompt: '点击 登录',
            updatedAt: '2026-06-12T06:00:00Z'
          },
          blockers: []
        }
      }),
      prompt: '点击 登录'
    });

    expect(readiness.canStart).toBe(true);
    expect(readiness.reasons).toEqual([]);
  });

  it('allows natural-language runs when the task target app id is set', () => {
    const readiness = getRunReadiness({
      environment: createEnvironment(),
      devices: [connectedDevice],
      selectedDeviceId: connectedDevice.id,
      task: createTask({
        targetAppId: 'com.example.app',
        input: {
          mode: 'natural_language',
          naturalLanguage: {
            prompt: '点击 登录',
            updatedAt: '2026-06-12T06:00:00Z'
          },
          blockers: []
        }
      }),
      prompt: '点击 登录'
    });

    expect(readiness.canStart).toBe(true);
    expect(readiness.reasons).toEqual([]);
  });

  it('blocks active task restarts instead of starting duplicate runs', () => {
    const readiness = getRunReadiness({
      environment: createEnvironment(),
      devices: [connectedDevice],
      selectedDeviceId: connectedDevice.id,
      task: createTask({
        status: 'running',
        latestRunId: 'run-1'
      }),
      prompt: ''
    });

    expect(readiness.canStart).toBe(false);
    expect(readiness.reasons).toContain('Task task-1 is running.');
  });

  it('allows completed tasks to be retested with the existing input', () => {
    const readiness = getRunReadiness({
      environment: createEnvironment(),
      devices: [connectedDevice],
      selectedDeviceId: connectedDevice.id,
      task: createTask({
        status: 'succeeded',
        latestRunId: 'run-1',
        runIds: ['run-1']
      }),
      prompt: ''
    });

    expect(readiness.canStart).toBe(true);
    expect(readiness.reasons).toEqual([]);
  });
});

describe('workbench task refresh', () => {
  it('restores the latest task when refresh returns two tasks in manifest order', () => {
    const olderTask = createTask({
      id: 'task-older',
      name: 'Older task',
      createdAt: '2026-06-25T03:00:00.000Z',
      updatedAt: '2026-06-25T03:05:00.000Z'
    });
    const latestTask = createTask({
      id: 'task-latest',
      name: 'Latest task',
      createdAt: '2026-06-25T03:10:00.000Z',
      updatedAt: '2026-06-25T03:15:00.000Z',
      input: {
        mode: 'natural_language',
        naturalLanguage: {
          prompt: 'Run latest smoke test',
          updatedAt: '2026-06-25T03:15:00.000Z'
        },
        blockers: []
      }
    });

    expect(getCurrentTaskAfterRefresh(null, [olderTask, latestTask])).toEqual(latestTask);
  });

  it('keeps an active task selected when refresh returns a newer task', () => {
    const activeTask = createTask({
      id: 'task-active',
      updatedAt: '2026-06-25T03:05:00.000Z'
    });
    const newerTask = createTask({
      id: 'task-newer',
      updatedAt: '2026-06-25T03:15:00.000Z'
    });

    expect(getCurrentTaskAfterRefresh(activeTask, [newerTask])).toEqual(activeTask);
  });

  it('keeps the selected task id but uses refreshed task fields', () => {
    const refreshedSelectedTask = createTask({
      id: 'task-selected',
      name: 'Selected after refresh',
      status: 'running',
      latestRunId: 'run-selected',
      updatedAt: '2026-06-25T03:20:00.000Z'
    });
    const newerTask = createTask({
      id: 'task-newer',
      name: 'Newer task',
      updatedAt: '2026-06-25T03:25:00.000Z'
    });

    expect(getSelectedTaskAfterRefresh('task-selected', [newerTask, refreshedSelectedTask])).toEqual(
      refreshedSelectedTask
    );
  });

  it('upserts changed tasks and keeps the task list ordered by recency', () => {
    const olderTask = createTask({
      id: 'task-older',
      name: 'Older task',
      updatedAt: '2026-06-25T03:05:00.000Z'
    });
    const currentTask = createTask({
      id: 'task-current',
      name: 'Current task',
      updatedAt: '2026-06-25T03:15:00.000Z'
    });
    const updatedOlderTask = createTask({
      id: 'task-older',
      name: 'Older task after import',
      updatedAt: '2026-06-25T03:30:00.000Z'
    });

    expect(upsertTaskList([currentTask, olderTask], updatedOlderTask)).toEqual([
      updatedOlderTask,
      currentTask
    ]);
  });
});

describe('workbench task run log summaries', () => {
  it('groups flat task log entries into newest-first per-run summaries', () => {
    const summaries = buildTaskRunLogSummaries(createTask({
      latestRunId: 'run-2',
      runIds: ['run-1', 'run-2'],
      logs: [
        {
          id: 'log-created',
          kind: 'task_created',
          message: 'Task task-1 created.',
          createdAt: '2026-06-25T02:00:00.000Z',
          status: 'draft'
        },
        {
          id: 'log-run-1-start',
          kind: 'run_started',
          message: 'Run started.',
          createdAt: '2026-06-25T03:00:00.000Z',
          runId: 'run-1',
          status: 'queued'
        },
        {
          id: 'log-run-1-complete',
          kind: 'run_completed',
          message: 'Run finished.',
          createdAt: '2026-06-25T03:04:00.000Z',
          runId: 'run-1',
          status: 'failed'
        },
        {
          id: 'log-run-2-start',
          kind: 'run_started',
          message: 'Run started.',
          createdAt: '2026-06-25T04:00:00.000Z',
          runId: 'run-2',
          status: 'queued'
        },
        {
          id: 'log-run-2-report',
          kind: 'report_generated',
          message: 'Markdown report exported.',
          createdAt: '2026-06-25T04:06:00.000Z',
          runId: 'run-2',
          reportPath: '/tmp/task-1/reports/task-1.md',
          status: 'succeeded'
        }
      ]
    }));

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      runId: 'run-2',
      status: 'succeeded',
      startedAt: '2026-06-25T04:00:00.000Z',
      updatedAt: '2026-06-25T04:06:00.000Z',
      reportPath: '/tmp/task-1/reports/task-1.md',
      detailCount: 2
    });
    expect(summaries[0].entries.map((entry) => entry.id)).toEqual([
      'log-run-2-start',
      'log-run-2-report'
    ]);
    expect(summaries[1]).toMatchObject({
      runId: 'run-1',
      status: 'failed',
      detailCount: 2
    });
  });

  it('uses the live task status for the latest run summary while execution is active', () => {
    const summaries = buildTaskRunLogSummaries(createTask({
      status: 'running',
      latestRunId: 'run-2',
      runIds: ['run-1', 'run-2'],
      updatedAt: '2026-06-25T04:02:00.000Z',
      logs: [
        {
          id: 'log-run-1-start',
          kind: 'run_started',
          message: 'Run started.',
          createdAt: '2026-06-25T03:00:00.000Z',
          runId: 'run-1',
          status: 'queued'
        },
        {
          id: 'log-run-1-complete',
          kind: 'run_completed',
          message: 'Run finished.',
          createdAt: '2026-06-25T03:05:00.000Z',
          runId: 'run-1',
          status: 'failed'
        },
        {
          id: 'log-run-2-start',
          kind: 'run_started',
          message: 'Run started.',
          createdAt: '2026-06-25T04:00:00.000Z',
          runId: 'run-2',
          status: 'queued'
        }
      ]
    }));

    expect(summaries[0]).toMatchObject({
      runId: 'run-2',
      status: 'running'
    });
    expect(summaries[1]).toMatchObject({
      runId: 'run-1',
      status: 'failed'
    });
  });
});

describe('workbench device inspection', () => {
  it('does not prefer disconnected devices as executable selections', () => {
    expect(getPreferredDeviceId([disconnectedDevice], '')).toBe('');
    expect(getPreferredDeviceId([disconnectedDevice, connectedDevice], disconnectedDevice.id)).toBe(
      connectedDevice.id
    );
    expect(getPreferredDeviceId([disconnectedDevice, connectedDevice], connectedDevice.id)).toBe(
      connectedDevice.id
    );
  });

  it('counts Android and iOS physical plus virtual devices separately', () => {
    const summary = getDeviceInspectionSummary([
      connectedDevice,
      launchableSimulator,
      disconnectedPhysicalDevice,
      {
        id: 'web-1',
        name: 'Chrome',
        platform: 'web',
        type: 'unknown',
        connected: true
      }
    ]);

    expect(summary.totalSupported).toBe(3);
    expect(summary.connected).toBe(1);
    expect(summary.virtual).toBe(2);
    expect(summary.physical).toBe(1);
    expect(summary.startable).toBe(1);
  });

  it('allows only disconnected Android emulators and iOS simulators to show start actions', () => {
    expect(isVirtualDevice(connectedDevice)).toBe(true);
    expect(isVirtualDevice(launchableSimulator)).toBe(true);
    expect(isVirtualDevice(disconnectedPhysicalDevice)).toBe(false);
    expect(isStartableDevice(launchableSimulator)).toBe(true);
    expect(isStartableDevice(connectedDevice)).toBe(false);
    expect(isStartableDevice(disconnectedDevice)).toBe(false);
    expect(isStartableDevice(offlineAdbEmulator)).toBe(false);
    expect(isStartableDevice(disconnectedPhysicalDevice)).toBe(false);
    expect(isStoppableDevice(connectedDevice)).toBe(true);
    expect(isStoppableDevice(launchableSimulator)).toBe(false);
    expect(isStoppableDevice(disconnectedPhysicalDevice)).toBe(false);
  });

  it('detects a newly visible runtime device after a virtual device start', () => {
    const startedDevice = {
      ...launchableSimulator,
      id: 'android-avd:Medium_Phone',
      name: 'Medium Phone',
      platform: 'android' as const,
      type: 'emulator' as const
    };
    const previousConnectedDeviceIds = new Set(['emulator-5556']);

    expect(
      hasStartedDeviceAppeared(
        [
          { ...connectedDevice, id: 'emulator-5556' },
          {
            id: 'emulator-5554',
            name: 'Medium Phone',
            platform: 'android',
            type: 'emulator',
            connected: true
          }
        ],
        startedDevice,
        previousConnectedDeviceIds
      )
    ).toBe(true);
  });

  it('maps backend device start statuses into renderer action states', () => {
    expect(
      mapDeviceStartResultToAction(
        {
          deviceId: 'android-avd:Pixel_8',
          status: 'starting',
          detail: 'Android emulator Pixel_8 is starting.'
        } as DeviceStartResult,
        'Pixel 8'
      )
    ).toEqual({
      status: 'success',
      detail: 'Android emulator Pixel_8 is starting.',
      deviceId: 'android-avd:Pixel_8'
    });

    expect(
      mapDeviceStartResultToAction(
        {
          deviceId: 'ios-simulator-1',
          status: 'already_running',
          detail: 'iPhone 16 is already running.'
        } as DeviceStartResult,
        'iPhone 16'
      )
    ).toMatchObject({
      status: 'success',
      detail: 'iPhone 16 is already running.'
    });

    expect(
      mapDeviceStartResultToAction(
        {
          deviceId: 'emulator-5554',
          status: 'not_startable',
          detail: 'Physical and adb devices cannot be launched.'
        } as DeviceStartResult,
        'Pixel offline'
      )
    ).toMatchObject({
      status: 'error',
      detail: 'Physical and adb devices cannot be launched.'
    });

    expect(
      mapDeviceStopResultToAction(
        {
          deviceId: 'ios-simulator-1',
          status: 'stopped',
          detail: 'Stopped iOS simulator "iPhone 16".'
        } as DeviceStopResult,
        'iPhone 16'
      )
    ).toMatchObject({
      status: 'success',
      detail: 'Stopped iOS simulator "iPhone 16".'
    });

    expect(
      mapDeviceStopResultToAction(
        {
          deviceId: 'ios-physical-1',
          status: 'not_stoppable',
          detail: 'Physical devices cannot be stopped.'
        } as DeviceStopResult,
        'Jane iPhone'
      )
    ).toMatchObject({
      status: 'error',
      detail: 'Physical devices cannot be stopped.'
    });
  });
});

describe('workbench upload and viewer rules', () => {
  it('rejects unsupported or oversized test case files before import', () => {
    expect(validateCaseFile({ name: 'notes.txt', size: 10 })).toEqual({
      valid: false,
      detail: 'Supported formats: .yaml, .yml.'
    });
    expect(validateCaseFile({ name: 'flows.zip', size: 10 })).toEqual({
      valid: false,
      detail: 'Supported formats: .yaml, .yml.'
    });
    expect(validateCaseFile({ name: 'flow.yaml', size: 26 * 1024 * 1024 })).toEqual({
      valid: false,
      detail: 'File is larger than 25 MB.'
    });
  });

  it('creates import requests from Electron file paths when available', () => {
    expect(
      createCaseImportRequest({
        name: 'flow.yaml',
        size: 100,
        path: '/tmp/flow.yaml'
      })
    ).toEqual({
      sourcePath: '/tmp/flow.yaml',
      displayName: 'flow.yaml'
    });
  });

  it('maps viewer probe results into visible workbench states', () => {
    expect(
      mapViewerProbeResult({
        url: 'http://127.0.0.1:10000/',
        allowed: true,
        reachable: 'unchecked',
        detail: 'Local target accepted.'
      })
    ).toEqual({
      status: 'accepted',
      detail: 'Local target accepted.'
    });
  });
});

describe('workbench report placeholder', () => {
  it('summarizes failed runs with target, case, and redacted failure reason', () => {
    const run: TestRun = {
      id: 'run-1',
      caseId: importedCase.id,
      deviceId: connectedDevice.id,
      prompt: 'Run smoke',
      status: 'failed',
      createdAt: '2026-06-12T06:00:00Z',
      updatedAt: '2026-06-12T06:00:03Z',
      failureReason: 'Authorization: Bearer secret-token failed for /Users/alice/.maestro'
    };
    const report = createReportPlaceholder({
      run,
      device: connectedDevice,
      testCase: importedCase
    }, 'en');

    expect(report.status).toBe('failed');
    expect(report.summary).toBe(
      'Authorization: [REDACTED] failed for /Users/[REDACTED]/.maestro'
    );
    expect(report.failureReason).toBe(
      'Authorization: [REDACTED] failed for /Users/[REDACTED]/.maestro'
    );
    expect(report.markdown).toContain('Pixel 8');
    expect(report.markdown).toContain('smoke.yaml');
    expect(report.markdown).not.toContain('secret-token');
    expect(report.markdown).not.toContain('/Users/alice');
    expect(report.markdown).toContain(
      'Authorization: [REDACTED] failed for /Users/[REDACTED]/.maestro'
    );
  });

  it('redacts fallback error and prompt text before markdown rendering', () => {
    const run: TestRun = {
      id: 'run-2',
      caseId: importedCase.id,
      deviceId: connectedDevice.id,
      prompt: 'Use api_key=secret-key in /Users/alice/.maestro',
      status: 'failed',
      createdAt: '2026-06-12T06:00:00Z',
      updatedAt: '2026-06-12T06:00:03Z',
      failureReason: 'token=secret-token failed for /Users/alice/.maestro'
    };
    const report = createReportPlaceholder({
      run,
      device: connectedDevice,
      testCase: importedCase,
      error: 'Report fallback failed with password=hunter2 at /Users/alice/.maestro'
    }, 'en');

    const serializedReport = JSON.stringify(report);

    expect(serializedReport).not.toContain('secret-token');
    expect(serializedReport).not.toContain('secret-key');
    expect(serializedReport).not.toContain('hunter2');
    expect(serializedReport).not.toContain('/Users/alice');
    expect(report.summary).toBe(
      'Report fallback failed with password=[REDACTED] at /Users/[REDACTED]/.maestro'
    );
    expect(report.markdown).toContain('api_key=[REDACTED] in /Users/[REDACTED]/.maestro');
    expect(report.markdown).toContain('token=[REDACTED] failed for /Users/[REDACTED]/.maestro');
  });
});

describe('workbench localization', () => {
  it('keeps initial upload detail canonical while status labels default to Chinese', () => {
    expect(createInitialUploadState().detail).toBe('Supported formats: .yaml, .yml. Maximum size: 25 MB.');
    expect(localizeText(createInitialUploadState().detail, 'zh')).toBe(
      '支持格式：.yaml、.yml。最大 25 MB。'
    );
    expect(formatStatusLabel('not_configured')).toBe('未配置');
  });

  it('keeps readiness and upload validation messages canonical for render-time localization', () => {
    const readiness = getRunReadiness({
      environment: null,
      devices: [],
      selectedDeviceId: '',
      task: null,
      prompt: ''
    });

    expect(readiness.reasons).toContain('Runtime status is still loading.');
    expect(readiness.reasons).toContain('Select a connected Android or iOS device.');
    expect(readiness.reasons.map((reason) => localizeText(reason, 'zh'))).toContain(
      '正在加载运行时状态。'
    );
    expect(readiness.reasons.map((reason) => localizeText(reason, 'zh'))).toContain(
      '请选择已连接的 Android 或 iOS 设备。'
    );
    expect(validateCaseFile({ name: 'notes.txt', size: 10 })).toEqual({
      valid: false,
      detail: 'Supported formats: .yaml, .yml.'
    });
  });

  it('keeps upload validation details canonical so the same state re-renders after switching language', () => {
    const validation = validateCaseFile({ name: 'notes.txt', size: 10 });

    expect(validation).toEqual({
      valid: false,
      detail: 'Supported formats: .yaml, .yml.'
    });

    if (!validation.valid) {
      expect(localizeText(validation.detail, 'zh')).toBe('支持格式：.yaml、.yml。');
      expect(localizeText(validation.detail, 'en')).toBe('Supported formats: .yaml, .yml.');
    }
  });

  it('keeps viewer blocked details canonical so the same state re-renders after switching language', () => {
    const blockedState = validateViewerUrl('https://example.com:10000/')!;

    expect(blockedState).toEqual({
      status: 'blocked',
      detail: 'Viewer URL must point to localhost, 127.0.0.1, or ::1.'
    });
    expect(localizeText(blockedState.detail, 'zh')).toBe(
      'Viewer URL 必须指向 localhost、127.0.0.1 或 ::1。'
    );
    expect(localizeText(blockedState.detail, 'en')).toBe(
      'Viewer URL must point to localhost, 127.0.0.1, or ::1.'
    );
  });

  it('localizes virtual device stop feedback for Chinese rendering', () => {
    expect(localizeText('Stopping Medium Phone.', 'zh')).toBe('正在关闭 Medium Phone。');
    expect(localizeText('Stopped Android virtual device "Medium Phone".', 'zh')).toBe(
      '已关闭 Android 虚拟设备“Medium Phone”。'
    );
    expect(localizeText('Device Medium Phone stop returned stopped.', 'zh')).toBe(
      '设备 Medium Phone 关闭返回：已关闭。'
    );
  });

  it('keeps fallback report placeholder fields canonical for render-time localization', () => {
    const report = createReportPlaceholder({
      run: {
        id: 'run-3',
        caseId: importedCase.id,
        deviceId: connectedDevice.id,
        prompt: 'Run smoke',
        status: 'blocked',
        createdAt: '2026-06-12T06:00:00Z',
        updatedAt: '2026-06-12T06:00:01Z'
      },
      device: connectedDevice,
      testCase: importedCase,
      error: 'Report generation requires the Electron main process.'
    });

    expect(report.title).toBe('Test report for smoke.yaml');
    expect(report.summary).toBe('Report generation requires the Electron main process.');
    expect(localizeText(report.title, 'zh')).toBe('测试报告：smoke.yaml');
    expect(localizeText(report.summary, 'zh')).toBe('报告生成需要 Electron 主进程。');
  });
});
