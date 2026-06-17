import { execFile } from 'node:child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface CommandError extends Error {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals;
  stdout?: string;
  stderr?: string;
}

export type ExecFile = (
  file: string,
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    timeout?: number;
  }
) => Promise<CommandResult>;

export const nodeExecFile: ExecFile = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        env: options.env,
        signal: options.signal,
        timeout: options.timeout
      },
      (error, stdout, stderr) => {
        if (error) {
          const commandError = error as CommandError;

          commandError.stdout = stdout;
          commandError.stderr = stderr;
          reject(commandError);
          return;
        }

        resolve({ stdout, stderr });
      }
    );
  });

export function describeCommandError(error: unknown): string {
  const commandError = error as CommandError;

  if (commandError.stderr?.trim()) {
    return commandError.stderr.trim();
  }

  if (commandError.stdout?.trim()) {
    return commandError.stdout.trim();
  }

  return commandError.message || 'Command failed.';
}
