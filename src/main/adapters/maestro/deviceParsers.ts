import type { DeviceInfo, DevicePlatform, DeviceType } from '../../../shared/types';

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
        connected: state === 'device'
      };
    });
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
        connected: device.state === 'Booted' && device.isAvailable !== false
      });
    }
  }

  return devices;
}
