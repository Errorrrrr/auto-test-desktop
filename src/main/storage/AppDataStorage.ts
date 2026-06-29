import { mkdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { TestCaseManifest, TestRun, TestTask } from '../../shared/types';
import { AppError } from '../services/AppError';
import { FileManifestStore } from './FileManifestStore';

const SAFE_WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function assertSafeWorkspaceId(taskId: string): void {
  if (!SAFE_WORKSPACE_ID_PATTERN.test(taskId)) {
    throw new AppError('INVALID_TASK_WORKSPACE_PATH', `Task workspace id is not safe: ${taskId}`);
  }
}

function resolveInsideRoot(rootDir: string, segments: string[]): string {
  const rootPath = resolve(rootDir);
  const targetPath = resolve(rootPath, ...segments);
  const relativePath = relative(rootPath, targetPath);

  if (relativePath && (relativePath.startsWith('..') || isAbsolute(relativePath))) {
    throw new AppError(
      'INVALID_TASK_WORKSPACE_PATH',
      `Task workspace path must stay inside ${rootDir}.`
    );
  }

  return targetPath;
}

export class TaskWorkspaceStorage {
  readonly rootDir: string;
  readonly artifactsDir: string;
  readonly generatedDir: string;
  readonly inputPath: string;
  readonly reportsDir: string;
  readonly runsDir: string;
  readonly taskPath: string;
  readonly uploadsDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.uploadsDir = this.resolveInside('uploads');
    this.generatedDir = this.resolveInside('generated');
    this.runsDir = this.resolveInside('runs');
    this.reportsDir = this.resolveInside('reports');
    this.artifactsDir = this.resolveInside('artifacts');
    this.taskPath = this.resolveInside('task.json');
    this.inputPath = this.resolveInside('input.json');
  }

  async ensure(): Promise<void> {
    await Promise.all([
      mkdir(this.uploadsDir, { recursive: true }),
      mkdir(this.generatedDir, { recursive: true }),
      mkdir(this.runsDir, { recursive: true }),
      mkdir(this.reportsDir, { recursive: true }),
      mkdir(this.artifactsDir, { recursive: true })
    ]);
  }

  getRunStore(): FileManifestStore<TestRun> {
    return new FileManifestStore<TestRun>(this.resolveInside('runs', 'manifest.json'));
  }

  getReportPath(fileName: string): string {
    return this.resolveInside('reports', fileName);
  }

  resolveInside(...segments: string[]): string {
    return resolveInsideRoot(this.rootDir, segments);
  }
}

export class AppDataStorage {
  readonly rootDir: string;
  readonly reportsDir: string;
  readonly runsDir: string;
  readonly settingsDir: string;
  readonly tasksDir: string;
  readonly testCasesDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.testCasesDir = join(rootDir, 'testcases');
    this.runsDir = join(rootDir, 'runs');
    this.reportsDir = join(rootDir, 'reports');
    this.settingsDir = join(rootDir, 'settings');
    this.tasksDir = join(rootDir, 'tasks');
  }

  async ensure(): Promise<void> {
    await Promise.all([
      mkdir(this.testCasesDir, { recursive: true }),
      mkdir(this.runsDir, { recursive: true }),
      mkdir(this.reportsDir, { recursive: true }),
      mkdir(this.settingsDir, { recursive: true }),
      mkdir(this.tasksDir, { recursive: true })
    ]);
  }

  getTestCaseStore(): FileManifestStore<TestCaseManifest> {
    return new FileManifestStore<TestCaseManifest>(join(this.testCasesDir, 'manifest.json'));
  }

  getRunStore(): FileManifestStore<TestRun> {
    return new FileManifestStore<TestRun>(join(this.runsDir, 'manifest.json'));
  }

  getTaskStore(): FileManifestStore<TestTask> {
    return new FileManifestStore<TestTask>(join(this.tasksDir, 'manifest.json'));
  }

  getTaskWorkspace(taskId: string): TaskWorkspaceStorage {
    assertSafeWorkspaceId(taskId);

    return new TaskWorkspaceStorage(resolveInsideRoot(this.tasksDir, [taskId]));
  }

  getTestCaseDirectory(testCaseId: string): string {
    return join(this.testCasesDir, testCaseId);
  }

  getReportPath(runId: string): string {
    return join(this.reportsDir, `${runId}.md`);
  }

  getCodexModelSettingsPath(): string {
    return join(this.settingsDir, 'codex-model.json');
  }
}
