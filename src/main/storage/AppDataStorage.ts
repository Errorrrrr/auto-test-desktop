import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { TestCaseManifest, TestRun } from '../../shared/types';
import { FileManifestStore } from './FileManifestStore';

export class AppDataStorage {
  readonly rootDir: string;
  readonly reportsDir: string;
  readonly runsDir: string;
  readonly testCasesDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.testCasesDir = join(rootDir, 'testcases');
    this.runsDir = join(rootDir, 'runs');
    this.reportsDir = join(rootDir, 'reports');
  }

  async ensure(): Promise<void> {
    await Promise.all([
      mkdir(this.testCasesDir, { recursive: true }),
      mkdir(this.runsDir, { recursive: true }),
      mkdir(this.reportsDir, { recursive: true })
    ]);
  }

  getTestCaseStore(): FileManifestStore<TestCaseManifest> {
    return new FileManifestStore<TestCaseManifest>(join(this.testCasesDir, 'manifest.json'));
  }

  getRunStore(): FileManifestStore<TestRun> {
    return new FileManifestStore<TestRun>(join(this.runsDir, 'manifest.json'));
  }

  getTestCaseDirectory(testCaseId: string): string {
    return join(this.testCasesDir, testCaseId);
  }

  getReportPath(runId: string): string {
    return join(this.reportsDir, `${runId}.md`);
  }
}
