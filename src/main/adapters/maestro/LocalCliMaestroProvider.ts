import type {
  DeviceInfo,
  DeviceStartRequest,
  DeviceStartResult,
  ServiceHealth
} from '../../../shared/types';
import type { MaestroProviderMode } from '../../config/runtimeConfig';
import {
  describeCommandError,
  type CommandError,
  type ExecFile,
  nodeExecFile,
  nodeSpawnFile,
  type SpawnFile
} from '../exec';
import type { MaestroProvider, MaestroRunFlowRequest, MaestroRunFlowResult } from './MaestroProvider';
import {
  parseAdbDevices,
  parseAndroidAvds,
  parseAndroidAvdDeviceId,
  parseSimctlDevices,
  parseXctraceIosPhysicalDevices
} from './deviceParsers';

interface LocalCliMaestroProviderOptions {
  adbCommand?: string;
  emulatorCommand?: string;
  execFile?: ExecFile;
  maestroCommand?: string;
  providerMode?: MaestroProviderMode;
  spawnFile?: SpawnFile;
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
  private readonly emulatorCommand: string;
  private readonly execFile: ExecFile;
  private readonly maestroCommand: string;
  private readonly providerMode: MaestroProviderMode;
  private readonly spawnFile: SpawnFile;
  private readonly xcrunCommand: string;

  constructor(options: LocalCliMaestroProviderOptions = {}) {
    this.adbCommand = options.adbCommand ?? 'adb';
    this.emulatorCommand = options.emulatorCommand ?? 'emulator';
    this.execFile = options.execFile ?? nodeExecFile;
    this.maestroCommand = options.maestroCommand ?? 'maestro';
    this.providerMode = options.providerMode ?? 'cli';
    this.spawnFile = options.spawnFile ?? nodeSpawnFile;
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
    const [androidResult, androidAvdResult, iosSimulatorResult, iosPhysicalResult] =
      await Promise.allSettled([
        this.execFile(this.adbCommand, ['devices', '-l'], { timeout: 5_000 }),
        this.execFile(this.emulatorCommand, ['-list-avds'], { timeout: 5_000 }),
        this.execFile(this.xcrunCommand, ['simctl', 'list', 'devices', '--json'], {
          timeout: 8_000
        }),
        this.execFile(this.xcrunCommand, ['xctrace', 'list', 'devices'], { timeout: 8_000 })
      ]);
    const devices: DeviceInfo[] = [];

    if (androidResult.status === 'fulfilled') {
      devices.push(...parseAdbDevices(androidResult.value.stdout));
    }

    if (androidAvdResult.status === 'fulfilled') {
      devices.push(...parseAndroidAvds(androidAvdResult.value.stdout));
    }

    if (iosSimulatorResult.status === 'fulfilled') {
      try {
        devices.push(...parseSimctlDevices(iosSimulatorResult.value.stdout));
      } catch {
        // Ignore malformed simctl output and keep any Android results.
      }
    }

    if (iosPhysicalResult.status === 'fulfilled') {
      devices.push(...parseXctraceIosPhysicalDevices(iosPhysicalResult.value.stdout));
    }

    return dedupeDevices(devices);
  }

  async startDevice(request: DeviceStartRequest): Promise<DeviceStartResult> {
    const devices = await this.listDevices();
    const device = devices.find((candidate) => candidate.id === request.deviceId);

    if (!device) {
      return {
        deviceId: request.deviceId,
        status: 'failed',
        detail: `Device "${request.deviceId}" was not found. Refresh devices and try again.`
      };
    }

    if (device.connected) {
      return {
        deviceId: device.id,
        device,
        status: 'already_running',
        detail: `${device.name} is already connected.`
      };
    }

    if (device.platform === 'android' && device.type === 'emulator') {
      return this.startAndroidVirtualDevice(device);
    }

    if (device.platform === 'ios' && device.type === 'simulator') {
      return this.startIosSimulator(device);
    }

    return {
      deviceId: device.id,
      device,
      status: 'not_startable',
      detail:
        device.platform === 'ios' || device.platform === 'android'
          ? `${device.name} is a physical device and cannot be started by the desktop client.`
          : `${device.name} is not an Android or iOS device.`
    };
  }

  private async startAndroidVirtualDevice(device: DeviceInfo): Promise<DeviceStartResult> {
    const avdName = parseAndroidAvdDeviceId(device.id);

    if (!avdName) {
      return {
        deviceId: device.id,
        device,
        status: 'not_startable',
        detail: `${device.name} is visible through adb, but its Android Virtual Device name is unknown.`
      };
    }

    try {
      await this.spawnFile(this.emulatorCommand, ['-avd', avdName]);

      return {
        deviceId: device.id,
        device: {
          ...device,
          state: 'Starting'
        },
        status: 'starting',
        detail: `Starting Android virtual device "${device.name}". Refresh devices after it boots.`
      };
    } catch (error) {
      return {
        deviceId: device.id,
        device,
        status: 'failed',
        detail: `Failed to start Android virtual device "${device.name}": ${describeCommandError(error)}`
      };
    }
  }

  private async startIosSimulator(device: DeviceInfo): Promise<DeviceStartResult> {
    try {
      await this.execFile(this.xcrunCommand, ['simctl', 'boot', device.id], { timeout: 15_000 });

      try {
        await this.execFile(this.xcrunCommand, ['simctl', 'bootstatus', device.id, '-b'], {
          timeout: 45_000
        });
      } catch {
        // Boot was requested successfully; bootstatus is best-effort for older Xcode versions.
      }

      return {
        deviceId: device.id,
        device: {
          ...device,
          connected: true,
          launchable: false,
          state: 'Booted'
        },
        status: 'started',
        detail: `Started iOS simulator "${device.name}".`
      };
    } catch (error) {
      const detail = describeCommandError(error);

      if (/already booted|current state:\s*Booted/i.test(detail)) {
        return {
          deviceId: device.id,
          device: {
            ...device,
            connected: true,
            launchable: false,
            state: 'Booted'
          },
          status: 'already_running',
          detail: `${device.name} is already booted.`
        };
      }

      return {
        deviceId: device.id,
        device,
        status: 'failed',
        detail: `Failed to start iOS simulator "${device.name}": ${detail}`
      };
    }
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
