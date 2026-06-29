import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

import type {
  DeviceInfo,
  DeviceStartRequest,
  DeviceStartResult,
  DeviceStopRequest,
  DeviceStopResult,
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

function hasPathSeparator(command: string): boolean {
  return command.includes('/') || command.includes('\\');
}

async function isExecutablePath(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutablePath(command: string, envPath = process.env.PATH ?? ''): Promise<string | undefined> {
  if (isAbsolute(command) || hasPathSeparator(command)) {
    return (await isExecutablePath(command)) ? command : undefined;
  }

  const pathEntries = [
    ...envPath.split(delimiter),
    '/usr/local/bin',
    '/opt/homebrew/bin'
  ].filter(Boolean);

  for (const pathEntry of Array.from(new Set(pathEntries))) {
    const candidate = join(pathEntry, command);

    if (await isExecutablePath(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function dedupeDevices(devices: DeviceInfo[]): DeviceInfo[] {
  const byId = new Map<string, DeviceInfo>();

  for (const device of devices) {
    byId.set(device.id, device);
  }

  return Array.from(byId.values());
}

function isAndroidAvdDevice(device: DeviceInfo): boolean {
  return (
    device.platform === 'android' &&
    device.type === 'emulator' &&
    device.source === 'android-avd'
  );
}

function isAndroidAdbEmulator(device: DeviceInfo): boolean {
  return device.platform === 'android' && device.type === 'emulator' && device.source === 'adb';
}

function mergeAndroidAvdRuntimeDevice(
  avdDevice: DeviceInfo,
  runtimeDevice: DeviceInfo
): DeviceInfo {
  return {
    ...runtimeDevice,
    name: avdDevice.name,
    connected: runtimeDevice.connected,
    launchable: false,
    source: runtimeDevice.source,
    state: runtimeDevice.state
  };
}

type PendingAndroidAvdStart = {
  knownAdbDeviceIds: Set<string>;
};

export class LocalCliMaestroProvider implements MaestroProvider {
  private readonly adbCommand: string;
  private readonly emulatorCommand: string;
  private readonly execFile: ExecFile;
  private readonly maestroCommand: string;
  private readonly providerMode: MaestroProviderMode;
  private readonly spawnFile: SpawnFile;
  private readonly xcrunCommand: string;
  private readonly androidAvdRuntimeDeviceIds = new Map<string, string>();
  private readonly pendingAndroidAvdStarts = new Map<string, PendingAndroidAvdStart>();

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

    if (this.providerMode === 'mcp') {
      return {
        status: 'ready',
        label: 'Maestro provider',
        detail:
          'Maestro MCP execution is delegated to Codex CLI. Local Maestro CLI is not used for task execution.'
      };
    }

    try {
      const resolvedCommand = await resolveExecutablePath(this.maestroCommand);

      if (!resolvedCommand) {
        throw new Error(`Command "${this.maestroCommand}" was not found or is not executable.`);
      }

      return {
        status: 'ready',
        label: 'Maestro provider',
        detail: `Maestro CLI command is configured (${resolvedCommand}). Version check is skipped until execution.`
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

    return this.mergeAndroidAvdRuntimeDevices(dedupeDevices(devices));
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
      return this.startAndroidVirtualDevice(device, devices);
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

  async stopDevice(request: DeviceStopRequest): Promise<DeviceStopResult> {
    const devices = await this.listDevices();
    const device = devices.find((candidate) => candidate.id === request.deviceId);

    if (!device) {
      return {
        deviceId: request.deviceId,
        status: 'failed',
        detail: `Device "${request.deviceId}" was not found. Refresh devices and try again.`
      };
    }

    if (!device.connected) {
      return {
        deviceId: device.id,
        device,
        status: 'already_stopped',
        detail: `${device.name} is already disconnected.`
      };
    }

    if (device.platform === 'android' && device.type === 'emulator') {
      return this.stopAndroidVirtualDevice(device);
    }

    if (device.platform === 'ios' && device.type === 'simulator') {
      return this.stopIosSimulator(device);
    }

    return {
      deviceId: device.id,
      device,
      status: 'not_stoppable',
      detail:
        device.platform === 'ios' || device.platform === 'android'
          ? `${device.name} is a physical device and cannot be stopped by the desktop client.`
          : `${device.name} is not an Android or iOS virtual device.`
    };
  }

  private mergeAndroidAvdRuntimeDevices(devices: DeviceInfo[]): DeviceInfo[] {
    const adbEmulators = devices.filter(isAndroidAdbEmulator);
    const usedRuntimeDeviceIds = new Set<string>();
    const mergedAvdDevices = new Map<string, DeviceInfo>();

    for (const device of devices) {
      if (!isAndroidAvdDevice(device)) {
        continue;
      }

      const mappedRuntimeId = this.androidAvdRuntimeDeviceIds.get(device.id);
      let runtimeDevice = mappedRuntimeId
        ? adbEmulators.find((candidate) => candidate.id === mappedRuntimeId)
        : undefined;

      if (!runtimeDevice) {
        const pendingStart = this.pendingAndroidAvdStarts.get(device.id);

        runtimeDevice = pendingStart
          ? adbEmulators.find(
              (candidate) =>
                !pendingStart.knownAdbDeviceIds.has(candidate.id) &&
                !usedRuntimeDeviceIds.has(candidate.id)
            )
          : undefined;
      }

      if (!runtimeDevice) {
        this.androidAvdRuntimeDeviceIds.delete(device.id);
        continue;
      }

      this.androidAvdRuntimeDeviceIds.set(device.id, runtimeDevice.id);
      this.pendingAndroidAvdStarts.delete(device.id);
      usedRuntimeDeviceIds.add(runtimeDevice.id);
      mergedAvdDevices.set(device.id, mergeAndroidAvdRuntimeDevice(device, runtimeDevice));
    }

    return devices.flatMap((device) => {
      const mergedDevice = mergedAvdDevices.get(device.id);

      if (mergedDevice) {
        return [mergedDevice];
      }

      return usedRuntimeDeviceIds.has(device.id) ? [] : [device];
    });
  }

  private getAndroidAvdIdForRuntimeDevice(runtimeDeviceId: string): string | undefined {
    for (const [avdDeviceId, mappedRuntimeDeviceId] of this.androidAvdRuntimeDeviceIds) {
      if (mappedRuntimeDeviceId === runtimeDeviceId) {
        return avdDeviceId;
      }
    }

    return undefined;
  }

  private toStoppedAndroidDevice(device: DeviceInfo): DeviceInfo {
    const avdDeviceId = this.getAndroidAvdIdForRuntimeDevice(device.id);

    if (avdDeviceId) {
      this.androidAvdRuntimeDeviceIds.delete(avdDeviceId);
      this.pendingAndroidAvdStarts.delete(avdDeviceId);

      return {
        ...device,
        id: avdDeviceId,
        connected: false,
        launchable: true,
        source: 'android-avd',
        state: 'Shutdown'
      };
    }

    return {
      ...device,
      connected: false,
      launchable: false,
      state: 'Shutdown'
    };
  }

  private async startAndroidVirtualDevice(
    device: DeviceInfo,
    currentDevices: DeviceInfo[]
  ): Promise<DeviceStartResult> {
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
      this.pendingAndroidAvdStarts.set(device.id, {
        knownAdbDeviceIds: new Set(
          currentDevices
            .filter(isAndroidAdbEmulator)
            .map((currentDevice) => currentDevice.id)
        )
      });

      return {
        deviceId: device.id,
        device: {
          ...device,
          launchable: false,
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

  private async stopAndroidVirtualDevice(device: DeviceInfo): Promise<DeviceStopResult> {
    try {
      await this.execFile(this.adbCommand, ['-s', device.id, 'emu', 'kill'], { timeout: 10_000 });

      return {
        deviceId: device.id,
        device: this.toStoppedAndroidDevice(device),
        status: 'stopped',
        detail: `Stopped Android virtual device "${device.name}".`
      };
    } catch (error) {
      return {
        deviceId: device.id,
        device,
        status: 'failed',
        detail: `Failed to stop Android virtual device "${device.name}": ${describeCommandError(error)}`
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

  private async stopIosSimulator(device: DeviceInfo): Promise<DeviceStopResult> {
    try {
      await this.execFile(this.xcrunCommand, ['simctl', 'shutdown', device.id], { timeout: 15_000 });

      return {
        deviceId: device.id,
        device: {
          ...device,
          connected: false,
          launchable: true,
          state: 'Shutdown'
        },
        status: 'stopped',
        detail: `Stopped iOS simulator "${device.name}".`
      };
    } catch (error) {
      const detail = describeCommandError(error);

      if (/already shutdown|not booted|current state:\s*Shutdown/i.test(detail)) {
        return {
          deviceId: device.id,
          device: {
            ...device,
            connected: false,
            launchable: true,
            state: 'Shutdown'
          },
          status: 'already_stopped',
          detail: `${device.name} is already shut down.`
        };
      }

      return {
        deviceId: device.id,
        device,
        status: 'failed',
        detail: `Failed to stop iOS simulator "${device.name}": ${detail}`
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
