import type { DeviceInfo, DevicePlatform, DeviceType } from '../../../shared/types';

const ANDROID_AVD_ID_PREFIX = 'android-avd:';

export function createAndroidAvdDeviceId(avdName: string): string {
  return `${ANDROID_AVD_ID_PREFIX}${encodeURIComponent(avdName)}`;
}

export function parseAndroidAvdDeviceId(deviceId: string): string | undefined {
  if (!deviceId.startsWith(ANDROID_AVD_ID_PREFIX)) {
    return undefined;
  }

  return decodeURIComponent(deviceId.slice(ANDROID_AVD_ID_PREFIX.length));
}

function parseAndroidModel(tokens: string[]): string | undefined {
  const modelToken = tokens.find((token) => token.startsWith('model:'));

  return modelToken?.replace(/^model:/, '').replace(/_/g, ' ');
}

function getAndroidDeviceType(id: string, tokens: string[]): DeviceType {
  const joinedTokens = tokens.join(' ').toLowerCase();

  if (id.startsWith('emulator-') || joinedTokens.includes('emulator') || joinedTokens.includes('sdk_gphone')) {
    return 'emulator';
  }

  return 'physical';
}

export function parseAdbDevices(stdout: string): DeviceInfo[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .map((line) => {
      const [id, state, ...tokens] = line.split(/\s+/);
      const model = parseAndroidModel(tokens);

      return {
        id,
        name: model || id,
        platform: 'android' as DevicePlatform,
        type: getAndroidDeviceType(id, tokens),
        connected: state === 'device',
        launchable: false,
        source: 'adb' as const,
        state
      };
    });
}

export function parseAndroidAvds(stdout: string): DeviceInfo[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((avdName) => ({
      id: createAndroidAvdDeviceId(avdName),
      name: avdName.replace(/_/g, ' '),
      platform: 'android' as DevicePlatform,
      type: 'emulator' as DeviceType,
      connected: false,
      launchable: true,
      source: 'android-avd' as const,
      state: 'Shutdown'
    }));
}

interface SimctlDevice {
  name?: string;
  udid?: string;
  state?: string;
  isAvailable?: boolean;
  deviceTypeIdentifier?: string;
}

interface SimctlListDevices {
  devices?: Record<string, SimctlDevice[]>;
}

function getSimulatorPlatform(runtimeName: string): DevicePlatform {
  return runtimeName.toLowerCase().includes('ios') ? 'ios' : 'unknown';
}

export function parseSimctlDevices(stdout: string): DeviceInfo[] {
  const parsed = JSON.parse(stdout) as SimctlListDevices;
  const devicesByRuntime = parsed.devices ?? {};
  const devices: DeviceInfo[] = [];

  for (const [runtimeName, runtimeDevices] of Object.entries(devicesByRuntime)) {
    const platform = getSimulatorPlatform(runtimeName);

    for (const device of runtimeDevices) {
      if (!device.udid || platform === 'unknown') {
        continue;
      }

      devices.push({
        id: device.udid,
        name: device.name || device.udid,
        platform,
        type: 'simulator',
        connected: device.state === 'Booted' && device.isAvailable !== false,
        launchable: device.state !== 'Booted' && device.isAvailable !== false,
        source: 'simctl' as const,
        state: device.state
      });
    }
  }

  return devices;
}

export function parseXctraceIosPhysicalDevices(stdout: string): DeviceInfo[] {
  const devices: DeviceInfo[] = [];
  let inDevicesSection = false;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (line === '== Devices ==') {
      inDevicesSection = true;
      continue;
    }

    if (line.startsWith('==')) {
      inDevicesSection = false;
      continue;
    }

    if (!inDevicesSection || line.includes('(Simulator)')) {
      continue;
    }

    const match = line.match(/^(.+?)\s+\(([^)]+)\)\s+\(([^)]+)\)$/);

    if (!match) {
      continue;
    }

    const [, name, osVersion, id] = match;

    if (!/\b(iPhone|iPad|iPod)\b/i.test(name)) {
      continue;
    }

    devices.push({
      id,
      name,
      platform: 'ios',
      type: 'physical',
      connected: true,
      launchable: false,
      source: 'xctrace',
      state: `Connected (${osVersion})`
    });
  }

  return devices;
}
