import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import type { TestCaseFormat, TestCaseManifest } from '../../shared/types';
import type { AppDataStorage } from '../storage/AppDataStorage';
import { AppError } from './AppError';
import { optionalStringField, requireStringField } from './validation';

type TestCaseServiceOptions = {
  maxUploadSizeBytes: number;
  storage: AppDataStorage;
};

function getSupportedFormat(sourcePath: string): TestCaseFormat {
  const extension = extname(sourcePath).toLowerCase();

  if (extension === '.yaml' || extension === '.yml') {
    return 'yaml';
  }

  if (extension === '.zip') {
    throw new AppError(
      'ZIP_TEST_CASE_NOT_SUPPORTED',
      'Zip test cases are not enabled in P0. Upload a .yaml or .yml Maestro flow.'
    );
  }

  throw new AppError('UNSUPPORTED_TEST_CASE_FORMAT', 'Supported test case formats: .yaml, .yml.');
}

function formatBytes(bytes: number): string {
  const megabytes = bytes / 1024 / 1024;

  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB`;
}

function validateYamlContent(content: string): string[] {
  const meaningfulLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line !== '---');

  if (meaningfulLines.length === 0) {
    return ['YAML test case is empty.'];
  }

  return [];
}

export class TestCaseService {
  private readonly maxUploadSizeBytes: number;
  private readonly storage: AppDataStorage;

  constructor(options: TestCaseServiceOptions) {
    this.maxUploadSizeBytes = options.maxUploadSizeBytes;
    this.storage = options.storage;
  }

  async importCase(request: unknown): Promise<TestCaseManifest> {
    const sourcePath = requireStringField(request, 'sourcePath');
    const displayName = optionalStringField(request, 'displayName');
    const format = getSupportedFormat(sourcePath);
    const sourceStat = await this.getSourceStat(sourcePath);

    if (sourceStat.isDirectory()) {
      throw new AppError(
        'DIRECTORY_TEST_CASE_NOT_SUPPORTED',
        'Directory import is reserved for a follow-up adapter and is not enabled in P0.'
      );
    }

    if (sourceStat.size > this.maxUploadSizeBytes) {
      throw new AppError(
        'TEST_CASE_TOO_LARGE',
        `Test case is ${formatBytes(sourceStat.size)}; max upload size is ${formatBytes(this.maxUploadSizeBytes)}.`
      );
    }

    const validationMessages = await this.validateCase(sourcePath);

    if (validationMessages.length > 0) {
      throw new AppError('INVALID_TEST_CASE', validationMessages.join(' '));
    }

    await this.storage.ensure();

    const id = `case-${randomUUID()}`;
    const destinationDir = this.storage.getTestCaseDirectory(id);
    const destinationPath = join(destinationDir, basename(sourcePath));

    await mkdir(destinationDir, { recursive: true });
    await copyFile(sourcePath, destinationPath);

    const manifest: TestCaseManifest = {
      id,
      name: displayName ?? basename(sourcePath),
      sourcePath,
      storedPath: destinationPath,
      originalSourcePath: sourcePath,
      sizeBytes: sourceStat.size,
      format,
      importedAt: new Date().toISOString(),
      status: 'imported',
      validationMessages: []
    };

    await this.storage.getTestCaseStore().upsert(manifest);

    return manifest;
  }

  private async getSourceStat(sourcePath: string): Promise<Stats> {
    try {
      return await stat(sourcePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AppError('TEST_CASE_SOURCE_NOT_FOUND', `Test case source was not found: ${sourcePath}`);
      }

      throw error;
    }
  }

  private async validateCase(sourcePath: string): Promise<string[]> {
    return validateYamlContent(await readFile(sourcePath, 'utf8'));
  }
}
