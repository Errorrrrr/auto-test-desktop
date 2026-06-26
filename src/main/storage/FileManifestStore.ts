import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ManifestRecord {
  id: string;
}

export class FileManifestStore<T extends ManifestRecord> {
  private readonly filePath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async list(): Promise<T[]> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content) as unknown;

      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  async get(id: string): Promise<T | undefined> {
    const records = await this.list();

    return records.find((record) => record.id === id);
  }

  async upsert(record: T): Promise<void> {
    const mutation = this.mutationQueue.then(async () => {
      const records = await this.list();
      const nextRecords = records.filter((existing) => existing.id !== record.id);

      nextRecords.push(record);
      await this.write(nextRecords);
    });

    this.mutationQueue = mutation.catch(() => undefined);
    await mutation;
  }

  async delete(id: string): Promise<void> {
    const mutation = this.mutationQueue.then(async () => {
      const records = await this.list();
      const nextRecords = records.filter((existing) => existing.id !== id);

      await this.write(nextRecords);
    });

    this.mutationQueue = mutation.catch(() => undefined);
    await mutation;
  }

  private async write(records: T[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const tempPath = `${this.filePath}.tmp`;
    const content = `${JSON.stringify(records, null, 2)}\n`;

    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, this.filePath);
  }
}
