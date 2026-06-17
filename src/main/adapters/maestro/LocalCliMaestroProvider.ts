import type { DeviceInfo, ServiceHealth } from '../../../shared/types';
import type { MaestroProviderMode } from '../../config/runtimeConfig';
import { describeCommandError, type CommandError, type ExecFile, nodeExecFile } from '../exec';
import type { MaestroProvider, MaestroRunFlowRequest, MaestroRunFlowResult } from './MaestroProvider';
import { parseAdbDevices, parseSimctlDevices } from './deviceParsers';

interface LocalCliMaestroProviderOptions {
  adbCommand?: string;
  execFile?: ExecFile;
  maestroCommand?: string;
  providerMode?: MaestroProviderMode;
  xcrunCommand?: string;
}

function summarizeVersion(stdout: string, stderr: string): string {
  const value = stdout.trim() || stderr.trim();

  return value.split(/\r?\n/)[0] || 'version command completed';
}

function dedupeDevices(devices: DeviceInfo[]): DeviceInfo[] {
  const byId = new Map<string, DeviceInfo>();

  for (const device of devices) {
    byId.set(device.id, device);
  }

  return Array.from(byId.values());
}

export class LocalCliMaestroProvider implements MaestroProvider {
  private readonly adbCommand: string;
  private readonly execFile: ExecFile;
  private readonly maestroCommand: string;
  private readonly providerMode: MaestroProviderMode;
  private readonly xcrunCommand: string;

  constructor(options: LocalCliMaestroProviderOptions = {}) {
    this.adbCommand = options.adbCommand ?? 'adb';
    this.execFile = options.execFile ?? nodeExecFile;
    this.maestroCommand = options.maestroCommand ?? 'maestro';
    this.providerMode = options.providerMode ?? 'cli';
    this.xcrunCommand = options.xcrunCommand ?? 'xcrun';
  }

  async health(): Promise<ServiceHealth> {
    if (this.providerMode === 'disabled') {
      return {
        status: 'not_configured',
        label: 'Maestro provider',
        detail: 'Maestro provider is disabled by configuration.'
      };
    }

    try {
      const { stdout, stderr } = await this.execFile(this.maestroCommand, ['--version'], {
        timeout: 5_000
      });
      const detail =
        this.providerMode === 'mcp'
          ? `Direct MCP calls are not available inside the desktop client; CLI fallback is available (${summarizeVersion(stdout, stderr)}).`
          : `Maestro CLI is available (${summarizeVersion(stdout, stderr)}).`;

      return {
        status: this.providerMode === 'mcp' ? 'degraded' : 'ready',
        label: 'Maestro provider',
        detail
      };
    } catch (error) {
      return {
        status: 'disconnected',
        label: 'Maestro provider',
        detail: `Maestro MCP/CLI is unavailable: ${describeCommandError(error)}`
      };
    }
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const [androidResult, iosResult] = await Promise.allSettled([
      this.execFile(this.adbCommand, ['devices', '-l'], { timeout: 5_000 }),
      this.execFile(this.xcrunCommand, ['simctl', 'list', 'devices', '--json'], { timeout: 8_000 })
    ]);
    const devices: DeviceInfo[] = [];

    if (androidResult.status === 'fulfilled') {
      devices.push(...parseAdbDevices(androidResult.value.stdout));
    }

    if (iosResult.status === 'fulfilled') {
      try {
        devices.push(...parseSimctlDevices(iosResult.value.stdout));
      } catch {
        // Ignore malformed simctl output and keep any Android results.
      }
    }

    return dedupeDevices(devices);
  }

  async runFlow(request: MaestroRunFlowRequest): Promise<MaestroRunFlowResult> {
    const args: string[] = [];

    if (request.deviceId) {
      args.push(`--udid=${request.deviceId}`);
    }

    args.push('test', request.flowPath);

    try {
      const { stdout, stderr } = await this.execFile(this.maestroCommand, args, {
        signal: request.signal,
        timeout: request.timeoutMs
      });

      return {
        status: 'succeeded',
        stdout,
        stderr
      };
    } catch (error) {
      const commandError = error as CommandError;
      const aborted = commandError.name === 'AbortError' || commandError.code === 'ABORT_ERR';
      const timedOut = !aborted && (commandError.killed || commandError.signal === 'SIGTERM');

      return {
        status: timedOut ? 'timeout' : 'failed',
        stdout: commandError.stdout ?? '',
        stderr: commandError.stderr ?? '',
        failureReason: aborted ? 'Maestro flow was cancelled.' : describeCommandError(error)
      };
    }
  }
}
