import type { DeviceInfo, ServiceHealth } from '../../shared/types';
import type {
  MaestroProvider,
  MaestroRunFlowRequest,
  MaestroRunFlowResult
} from '../adapters/maestro/MaestroProvider';

type DeviceServiceOptions = {
  provider: MaestroProvider;
};

export class DeviceService {
  private readonly provider: MaestroProvider;

  constructor(options: DeviceServiceOptions) {
    this.provider = options.provider;
  }

  async getHealth(): Promise<ServiceHealth> {
    return this.provider.health();
  }

  async listDevices(): Promise<DeviceInfo[]> {
    try {
      return await this.provider.listDevices();
    } catch {
      return [];
    }
  }

  async hasConnectedExecutableDevice(deviceId?: string): Promise<boolean> {
    const devices = await this.listDevices();

    return devices.some((device) => {
      const matchesDevice = deviceId ? device.id === deviceId : true;
      const executablePlatform = device.platform === 'android' || device.platform === 'ios';

      return matchesDevice && executablePlatform && device.connected;
    });
  }

  async runFlow(request: MaestroRunFlowRequest): Promise<MaestroRunFlowResult> {
    return this.provider.runFlow(request);
  }
}
