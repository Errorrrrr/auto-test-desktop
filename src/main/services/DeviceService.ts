import type {
  DeviceInfo,
  DeviceStartResult,
  DeviceStopResult,
  ServiceHealth
} from '../../shared/types';
import type {
  MaestroProvider,
  MaestroRunFlowRequest,
  MaestroRunFlowResult
} from '../adapters/maestro/MaestroProvider';
import { requireStringField } from './validation';

type DeviceServiceOptions = {
  provider: MaestroProvider;
  webDeviceProvider?: () => DeviceInfo | undefined;
};

export class DeviceService {
  private readonly provider: MaestroProvider;
  private readonly webDeviceProvider?: () => DeviceInfo | undefined;

  constructor(options: DeviceServiceOptions) {
    this.provider = options.provider;
    this.webDeviceProvider = options.webDeviceProvider;
  }

  async getHealth(): Promise<ServiceHealth> {
    return this.provider.health();
  }

  async listDevices(): Promise<DeviceInfo[]> {
    let devices: DeviceInfo[];

    try {
      devices = await this.provider.listDevices();
    } catch {
      devices = [];
    }

    const webDevice = this.webDeviceProvider?.();

    if (!webDevice) {
      return devices;
    }

    return [...devices.filter((device) => device.id !== webDevice.id), webDevice];
  }

  async hasConnectedExecutableDevice(deviceId?: string): Promise<boolean> {
    const devices = await this.listDevices();

    return devices.some((device) => {
      const matchesDevice = deviceId ? device.id === deviceId : true;
      const executablePlatform = device.platform === 'android' || device.platform === 'ios';

      return matchesDevice && executablePlatform && device.connected;
    });
  }

  async startDevice(payload: unknown): Promise<DeviceStartResult> {
    const deviceId = requireStringField(payload, 'deviceId');

    return this.provider.startDevice({ deviceId });
  }

  async stopDevice(payload: unknown): Promise<DeviceStopResult> {
    const deviceId = requireStringField(payload, 'deviceId');

    return this.provider.stopDevice({ deviceId });
  }

  async runFlow(request: MaestroRunFlowRequest): Promise<MaestroRunFlowResult> {
    return this.provider.runFlow(request);
  }
}
