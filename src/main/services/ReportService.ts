import { writeFile } from 'node:fs/promises';

import { redactReportText } from '../../shared/redaction';
import type { TestReport, TestRun, TestRunStatus } from '../../shared/types';
import type { AppDataStorage } from '../storage/AppDataStorage';
import { AppError } from './AppError';
import type { TestRunService } from './TestRunService';
import { requireStringField } from './validation';

export { redactReportText } from '../../shared/redaction';

const STATUS_CONCLUSION: Record<TestRunStatus, string> = {
  blocked: 'Blocked before execution',
  cancelled: 'Cancelled by user',
  failed: 'Failed',
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  timeout: 'Timed out'
};

function formatDuration(start: string, end: string): string {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return 'Pending';
  }

  return `${Math.max(1, Math.round((endMs - startMs) / 1000))}s`;
}

function formatTargetDevice(run: TestRun): string {
  const platform = run.devicePlatform ? `, ${run.devicePlatform}` : '';
  const type = run.deviceType ? `/${run.deviceType}` : '';
  const name = run.deviceName ?? run.deviceId;

  return `${name} (${run.deviceId}${platform}${type})`;
}

function formatTestCase(run: TestRun): string {
  return run.caseName ? `${run.caseName} (${run.caseId})` : run.caseId;
}

function buildMarkdown(run: TestRun, report: Omit<TestReport, 'markdown'>): string {
  const lines = [
    `# ${report.title}`,
    '',
    `- Run: ${run.id}`,
    `- Conclusion: ${report.conclusion}`,
    `- Status: ${run.status}`,
    `- Target device: ${report.targetDevice}`,
    `- Test case: ${report.testCase}`,
    `- Agent instruction: ${report.prompt}`,
    ...(run.agentDetail ? [`- Agent mode: ${redactReportText(run.agentDetail)}`] : []),
    `- Started: ${report.startedAt}`,
    `- Ended: ${report.endedAt}`,
    `- Duration: ${formatDuration(report.startedAt, report.endedAt)}`
  ];

  if (report.failureReason) {
    lines.push(`- Failure reason: ${report.failureReason}`);
  }

  const stdout = redactReportText(run.stdout?.trim());
  const stderr = redactReportText(run.stderr?.trim());

  if (stdout) {
    lines.push('', '## Stdout', '', '```text', stdout, '```');
  }

  if (stderr) {
    lines.push('', '## Stderr', '', '```text', stderr, '```');
  }

  return `${lines.join('\n')}\n`;
}

export class ReportService {
  private readonly storage: AppDataStorage;
  private readonly testRunService: TestRunService;

  constructor(options: { storage: AppDataStorage; testRunService: TestRunService }) {
    this.storage = options.storage;
    this.testRunService = options.testRunService;
  }

  async get(request: unknown): Promise<TestReport> {
    return this.generate(request);
  }

  async generate(request: unknown): Promise<TestReport> {
    const runId = requireStringField(request, 'runId');
    const run = await this.testRunService.getRun(runId);

    if (!run) {
      throw new AppError('RUN_NOT_FOUND', `Run ${runId} was not found.`);
    }

    const endedAt = run.completedAt ?? run.updatedAt;
    const conclusion = STATUS_CONCLUSION[run.status];
    const failureReason = redactReportText(run.failureReason);
    const summary = failureReason ?? `Run ${run.id} is ${run.status}.`;
    const reportWithoutMarkdown: Omit<TestReport, 'markdown'> = {
      runId,
      title: `Test report for ${redactReportText(run.caseName ?? run.caseId)}`,
      status: run.status,
      generatedAt: new Date().toISOString(),
      summary,
      targetDevice: redactReportText(formatTargetDevice(run)) ?? '',
      testCase: redactReportText(formatTestCase(run)) ?? '',
      prompt: redactReportText(run.prompt) ?? '',
      startedAt: run.startedAt ?? run.createdAt,
      endedAt,
      conclusion,
      failureReason
    };

    return {
      ...reportWithoutMarkdown,
      markdown: buildMarkdown(run, reportWithoutMarkdown)
    };
  }

  async exportReport(request: unknown): Promise<TestReport> {
    return this.exportMarkdown(request);
  }

  async exportMarkdown(request: unknown): Promise<TestReport> {
    const report = await this.generate(request);
    const filePath = this.storage.getReportPath(report.runId);

    await this.storage.ensure();
    await writeFile(filePath, report.markdown, 'utf8');

    return {
      ...report,
      filePath
    };
  }
}
