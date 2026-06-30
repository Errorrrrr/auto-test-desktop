import { writeFile } from 'node:fs/promises';

import { redactReportText } from '../../shared/redaction';
import type {
  CodexModelSnapshot,
  TaskReport,
  TaskReportArtifact,
  TestReport,
  TestRun,
  TestRunStatus,
  TestTask,
  TestTaskStatus
} from '../../shared/types';
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

const TASK_STATUS_CONCLUSION: Record<TestTaskStatus, string> = {
  blocked: 'Blocked before execution',
  cancelled: 'Cancelled by user',
  draft: 'Draft',
  failed: 'Failed',
  queued: 'Queued',
  ready: 'Ready',
  running: 'Running',
  succeeded: 'Succeeded',
  timeout: 'Timed out'
};

const MODEL_SOURCE_LABELS: Record<CodexModelSnapshot['source'], string> = {
  app_default: 'app default',
  codex_config: 'Codex config',
  custom: 'custom',
  preset: 'preset'
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

function formatModelSnapshot(modelSnapshot: CodexModelSnapshot | undefined): string {
  if (!modelSnapshot) {
    return 'Not recorded (legacy run)';
  }

  return `${modelSnapshot.modelName} (${MODEL_SOURCE_LABELS[modelSnapshot.source]})`;
}

function getTaskModelSnapshot(task: TestTask, run?: TestRun): CodexModelSnapshot | undefined {
  return run?.modelSnapshot ?? task.modelSnapshot;
}

function formatTaskTargetDevice(task: TestTask, run?: TestRun): string {
  if (run) {
    return formatTargetDevice(run);
  }

  if (task.deviceSnapshot) {
    const platform = task.deviceSnapshot.platform ? `, ${task.deviceSnapshot.platform}` : '';
    const type = task.deviceSnapshot.type ? `/${task.deviceSnapshot.type}` : '';

    return `${task.deviceSnapshot.name} (${task.deviceSnapshot.id}${platform}${type})`;
  }

  return task.deviceId ? `Unknown device (${task.deviceId})` : 'Not selected';
}

function formatTaskInputSummary(task: TestTask): string {
  const prompt = task.input.naturalLanguage?.prompt;
  const testCase = task.input.testCase;

  if (prompt && testCase) {
    return `Uploaded test case ${testCase.name} (${testCase.caseId}) with prompt: ${prompt}`;
  }

  if (testCase) {
    return `Uploaded test case ${testCase.name} (${testCase.caseId})`;
  }

  if (prompt) {
    return `Natural language prompt: ${prompt}`;
  }

  return 'No task input configured.';
}

function getTaskArtifacts(task: TestTask): TaskReportArtifact[] {
  const artifacts: TaskReportArtifact[] = [];

  if (task.input.testCase?.storedPath) {
    artifacts.push({
      label: task.input.testCase.name,
      path: task.input.testCase.storedPath,
      kind: 'flow'
    });
  }

  const reportPaths = Array.from(
    new Set([...(task.reportPaths ?? []), ...(task.reportPath ? [task.reportPath] : [])])
  );

  reportPaths.forEach((reportPath, index) => {
    artifacts.push({
      label: index === reportPaths.length - 1 ? 'Task report' : `Task report ${index + 1}`,
      path: reportPath,
      kind: 'report'
    });
  });

  return artifacts;
}

function buildTaskMarkdown(
  task: TestTask,
  run: TestRun | undefined,
  report: Omit<TaskReport, 'markdown'>
): string {
  const lines = [
    `# ${report.title}`,
    '',
    '## Task information',
    '',
    `- Task: ${task.id}`,
    ...(run ? [`- Run: ${run.id}`] : []),
    `- Status: ${report.status}`,
    `- Conclusion: ${report.conclusion}`,
    `- Codex model: ${report.modelSummary ?? formatModelSnapshot(report.modelSnapshot)}`,
    `- Target device: ${report.targetDevice}`,
    `- Started: ${report.startedAt}`,
    `- Ended: ${report.endedAt}`,
    `- Duration: ${formatDuration(report.startedAt, report.endedAt)}`,
    '',
    '## Input',
    '',
    `- Input mode: ${report.inputMode}`,
    `- Summary: ${report.inputSummary}`
  ];

  if (report.failureReason) {
    lines.push('', '## Failure reason', '', report.failureReason);
  }

  if (report.artifacts.length > 0) {
    lines.push('', '## Artifacts', '');

    for (const artifact of report.artifacts) {
      lines.push(`- ${artifact.label} (${artifact.kind}): ${redactReportText(artifact.path)}`);
    }
  }

  const stdout = redactReportText(run?.stdout?.trim());
  const stderr = redactReportText(run?.stderr?.trim());

  if (stdout) {
    lines.push('', '## Stdout', '', '```text', stdout, '```');
  }

  if (stderr) {
    lines.push('', '## Stderr', '', '```text', stderr, '```');
  }

  return `${lines.join('\n')}\n`;
}

function buildMarkdown(run: TestRun, report: Omit<TestReport, 'markdown'>): string {
  const lines = [
    `# ${report.title}`,
    '',
    `- Run: ${run.id}`,
    `- Conclusion: ${report.conclusion}`,
    `- Status: ${run.status}`,
    `- Codex model: ${report.modelSummary ?? formatModelSnapshot(report.modelSnapshot)}`,
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
    const modelSnapshot = run.modelSnapshot;
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
      failureReason,
      modelSummary: formatModelSnapshot(modelSnapshot),
      ...(modelSnapshot ? { modelSnapshot } : {})
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

  async generateForTask(task: TestTask, run?: TestRun): Promise<TaskReport> {
    const status = task.status;
    const failureReason = redactReportText(task.failureReason ?? run?.failureReason);
    const modelSnapshot = getTaskModelSnapshot(task, run);
    const reportWithoutMarkdown: Omit<TaskReport, 'markdown'> = {
      taskId: task.id,
      ...(run ? { runId: run.id } : {}),
      title: `Task report for ${redactReportText(task.name)}`,
      status,
      inputMode: task.input.mode,
      inputSummary: redactReportText(formatTaskInputSummary(task)) ?? '',
      targetDevice: redactReportText(formatTaskTargetDevice(task, run)) ?? '',
      startedAt: task.startedAt ?? run?.startedAt ?? task.createdAt,
      endedAt: task.completedAt ?? run?.completedAt ?? run?.updatedAt ?? task.updatedAt,
      conclusion: TASK_STATUS_CONCLUSION[status],
      ...(failureReason ? { failureReason } : {}),
      modelSummary: formatModelSnapshot(modelSnapshot),
      ...(modelSnapshot ? { modelSnapshot } : {}),
      artifacts: getTaskArtifacts(task)
    };

    return {
      ...reportWithoutMarkdown,
      markdown: buildTaskMarkdown(task, run, reportWithoutMarkdown)
    };
  }

  async exportTaskMarkdown(task: TestTask, run?: TestRun): Promise<TaskReport> {
    const report = await this.generateForTask(task, run);
    const workspace = this.storage.getTaskWorkspace(task.id);
    const filePath = workspace.getReportPath(`${task.id}.md`);

    await this.storage.ensure();
    await workspace.ensure();
    await writeFile(filePath, report.markdown, 'utf8');

    return {
      ...report,
      filePath,
      artifacts: [
        ...report.artifacts,
        {
          label: 'Task report',
          path: filePath,
          kind: 'report'
        }
      ]
    };
  }
}
