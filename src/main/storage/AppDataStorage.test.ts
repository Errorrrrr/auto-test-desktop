import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { TestTask } from '../../shared/types';
import { AppDataStorage } from './AppDataStorage';

const tempRoots: string[] = [];

async function createStorage(): Promise<{
  dataRoot: string;
  storage: AppDataStorage;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), 'app-auto-test-storage-'));
  const dataRoot = join(rootDir, 'data');

  tempRoots.push(rootDir);

  return {
    dataRoot,
    storage: new AppDataStorage(dataRoot)
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootDir) => rm(rootDir, { force: true, recursive: true })));
});

describe('AppDataStorage task workspace', () => {
  it('keeps legacy stores and creates the task manifest root', async () => {
    const { dataRoot, storage } = await createStorage();
    const task: TestTask = {
      id: 'task-smoke',
      name: 'Smoke test',
      status: 'draft',
      input: {
        mode: 'empty',
        blockers: ['Task input is required before execution.']
      },
      workspacePath: join(dataRoot, 'tasks', 'task-smoke'),
      createdAt: '2026-06-24T03:00:00Z',
      updatedAt: '2026-06-24T03:00:00Z'
    };

    await storage.ensure();
    await storage.getTaskStore().upsert(task);

    await expect(access(storage.testCasesDir)).resolves.toBeUndefined();
    await expect(access(storage.runsDir)).resolves.toBeUndefined();
    await expect(access(storage.reportsDir)).resolves.toBeUndefined();
    await expect(access(storage.tasksDir)).resolves.toBeUndefined();
    await expect(storage.getTaskStore().get(task.id)).resolves.toMatchObject({
      id: task.id,
      workspacePath: task.workspacePath
    });
  });

  it('builds task-scoped paths and rejects workspace escape attempts', async () => {
    const { storage } = await createStorage();
    const workspace = storage.getTaskWorkspace('task-safe');

    expect(workspace.rootDir).toBe(join(storage.tasksDir, 'task-safe'));
    expect(workspace.uploadsDir).toBe(join(storage.tasksDir, 'task-safe', 'uploads'));
    expect(workspace.generatedDir).toBe(join(storage.tasksDir, 'task-safe', 'generated'));
    expect(workspace.runsDir).toBe(join(storage.tasksDir, 'task-safe', 'runs'));
    expect(workspace.reportsDir).toBe(join(storage.tasksDir, 'task-safe', 'reports'));
    expect(workspace.artifactsDir).toBe(join(storage.tasksDir, 'task-safe', 'artifacts'));
    expect(workspace.taskPath).toBe(join(storage.tasksDir, 'task-safe', 'task.json'));
    expect(workspace.inputPath).toBe(join(storage.tasksDir, 'task-safe', 'input.json'));
    expect(workspace.resolveInside('uploads', 'case-1', 'flow.yaml')).toBe(
      join(storage.tasksDir, 'task-safe', 'uploads', 'case-1', 'flow.yaml')
    );

    expect(() => storage.getTaskWorkspace('../outside')).toThrow(
      expect.objectContaining({
        code: 'INVALID_TASK_WORKSPACE_PATH'
      })
    );
    expect(() => workspace.resolveInside('uploads', '../../outside.yaml')).toThrow(
      expect.objectContaining({
        code: 'INVALID_TASK_WORKSPACE_PATH'
      })
    );
  });
});
