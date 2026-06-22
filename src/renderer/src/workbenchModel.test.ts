import { describe, expect, it } from 'vitest';

import type {
  DeviceInfo,
  EnvironmentStatus,
  TestCaseManifest,
  TestRun
} from '../../shared/types';
import {
  createInitialUploadState,
  createCaseImportRequest,
  createReportPlaceholder,
  formatStatusLabel,
  getRunReadiness,
  mapViewerProbeResult,
  validateCaseFile
} from './workbenchModel';

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

const importedCase: TestCaseManifest = {
  id: 'case-1',
  name: 'smoke.yaml',
  sourcePath: 'smoke.yaml',
  format: 'yaml',
  importedAt: '2026-06-12T06:00:00Z',
  status: 'imported',
  validationMessages: []
};

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
      importedCase,
      prompt: 'Run smoke'
    }, 'en');

    expect(readiness.canStart).toBe(false);
    expect(readiness.reasons).toContain('Selected device is not connected for execution.');
    expect(readiness.reasons).toContain('No connected Android or iOS device is available.');
  });

  it('allows runs when environment, device, case, and prompt are ready', () => {
    const readiness = getRunReadiness({
      environment: createEnvironment(),
      devices: [connectedDevice],
      selectedDeviceId: connectedDevice.id,
      importedCase,
      prompt: 'Run smoke'
    }, 'en');

    expect(readiness.canStart).toBe(true);
    expect(readiness.reasons).toEqual([]);
    expect(readiness.selectedDevice).toEqual(connectedDevice);
  });
});

describe('workbench upload and viewer rules', () => {
  it('rejects unsupported or oversized test case files before import', () => {
    expect(validateCaseFile({ name: 'notes.txt', size: 10 }, 'en')).toEqual({
      valid: false,
      detail: 'Supported formats: .yaml, .yml.'
    });
    expect(validateCaseFile({ name: 'flows.zip', size: 10 }, 'en')).toEqual({
      valid: false,
      detail: 'Supported formats: .yaml, .yml.'
    });
    expect(validateCaseFile({ name: 'flow.yaml', size: 26 * 1024 * 1024 }, 'en')).toEqual({
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
      }, 'en')
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
  it('uses Chinese copy by default for upload and status labels', () => {
    expect(createInitialUploadState().detail).toBe('支持格式：.yaml、.yml。最大 25 MB。');
    expect(formatStatusLabel('not_configured')).toBe('未配置');
  });

  it('localizes readiness and upload validation messages', () => {
    const readiness = getRunReadiness({
      environment: null,
      devices: [],
      selectedDeviceId: '',
      importedCase: null,
      prompt: ''
    });

    expect(readiness.reasons).toContain('正在加载运行时状态。');
    expect(readiness.reasons).toContain('请选择已连接的 Android 或 iOS 设备。');
    expect(validateCaseFile({ name: 'notes.txt', size: 10 })).toEqual({
      valid: false,
      detail: '支持格式：.yaml、.yml。'
    });
  });
});
