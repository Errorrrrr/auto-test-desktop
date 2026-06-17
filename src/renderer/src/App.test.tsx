import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { DeviceInfo, TestCaseManifest, TestReport, TestRun } from '../../shared/types';
import { DeviceListPanel, ReportPanel, openAllowedViewerUrl } from './App';
import { createReportPlaceholder } from './workbenchModel';

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

describe('workbench panels', () => {
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

  it('renders a failed run report with redacted report fields only', () => {
    const run: TestRun = {
      id: 'run-1',
      caseId: 'case-1',
      deviceId: 'android-1',
      prompt: 'Run smoke',
      status: 'failed',
      createdAt: '2026-06-12T06:00:00Z',
      updatedAt: '2026-06-12T06:00:03Z',
      failureReason: 'Authorization: Bearer secret-token failed for /Users/alice/.maestro'
    };
    const report: TestReport = {
      runId: run.id,
      title: 'Smoke report',
      status: 'failed',
      generatedAt: run.updatedAt,
      summary: 'The run failed.',
      targetDevice: 'Pixel 8 (android-1, android/emulator)',
      testCase: 'smoke.yaml (case-1)',
      prompt: 'Run smoke',
      startedAt: run.createdAt,
      endedAt: run.updatedAt,
      conclusion: 'Failed',
      failureReason: 'Authorization: [REDACTED] failed for /Users/[REDACTED]/.maestro',
      markdown:
        '# Smoke report\n\n- Status: failed\n- Failure reason: Authorization: [REDACTED] failed for /Users/[REDACTED]/.maestro'
    };

    const html = renderToStaticMarkup(
      <ReportPanel
        report={report}
        run={run}
        exportState={{
          status: 'idle',
          detail: 'Report has not been exported.'
        }}
        context={{
          device: {
            id: 'android-1',
            name: 'Pixel 8',
            platform: 'android',
            type: 'emulator',
            connected: true
          },
          testCase: {
            id: 'case-1',
            name: 'smoke.yaml',
            sourcePath: 'smoke.yaml',
            format: 'yaml',
            importedAt: '2026-06-12T06:00:00Z',
            status: 'imported',
            validationMessages: []
          }
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

  it('keeps fallback placeholder secrets out of report HTML and markdown', () => {
    const run: TestRun = {
      id: 'run-2',
      caseId: 'case-1',
      deviceId: 'android-1',
      prompt: 'Run smoke with token=secret-token from /Users/alice/.maestro',
      status: 'failed',
      createdAt: '2026-06-12T06:00:00Z',
      updatedAt: '2026-06-12T06:00:03Z',
      failureReason: 'Authorization: Bearer secret-token failed for /Users/alice/.maestro'
    };
    const context = {
      device: {
        id: 'android-1',
        name: 'Pixel 8',
        platform: 'android',
        type: 'emulator',
        connected: true
      } satisfies DeviceInfo,
      testCase: {
        id: 'case-1',
        name: 'smoke.yaml',
        sourcePath: 'smoke.yaml',
        format: 'yaml',
        importedAt: '2026-06-12T06:00:00Z',
        status: 'imported',
        validationMessages: []
      } satisfies TestCaseManifest
    };
    const report = createReportPlaceholder({
      run,
      ...context,
      error: 'Report fallback used api_key=secret-key at /Users/alice/.maestro'
    });

    const html = renderToStaticMarkup(
      <ReportPanel
        report={report}
        run={run}
        exportState={{
          status: 'idle',
          detail: 'Report has not been exported.'
        }}
        context={context}
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
