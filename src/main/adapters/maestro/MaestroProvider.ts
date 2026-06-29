import type {
  DeviceInfo,
  DeviceStartRequest,
  DeviceStartResult,
  DeviceStopRequest,
  DeviceStopResult,
  ServiceHealth,
  TestRunStatus
} from '../../../shared/types';

export interface MaestroRunFlowRequest {
  flowPath: string;
  deviceId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface MaestroRunFlowResult {
  status: Extract<TestRunStatus, 'succeeded' | 'failed' | 'timeout'>;
  stdout: string;
  stderr: string;
  failureReason?: string;
}

export interface MaestroProvider {
  health(): Promise<ServiceHealth>;
  listDevices(): Promise<DeviceInfo[]>;
  startDevice(request: DeviceStartRequest): Promise<DeviceStartResult>;
  stopDevice(request: DeviceStopRequest): Promise<DeviceStopResult>;
  runFlow(request: MaestroRunFlowRequest): Promise<MaestroRunFlowResult>;
}

export class StaticMaestroProvider implements MaestroProvider {
  private readonly devices: DeviceInfo[];
  private readonly serviceHealth: ServiceHealth;

  constructor(
    devices: DeviceInfo[] = [],
    serviceHealth: ServiceHealth = {
      status: 'ready',
      label: 'Maestro mock provider',
      detail: 'Using injected device data for local tests.'
    }
  ) {
    this.devices = devices;
    this.serviceHealth = serviceHealth;
  }

  async health(): Promise<ServiceHealth> {
    return this.serviceHealth;
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return this.devices;
  }

  async startDevice(request: DeviceStartRequest): Promise<DeviceStartResult> {
    const device = this.devices.find((candidate) => candidate.id === request.deviceId);

    if (!device) {
      return {
        deviceId: request.deviceId,
        status: 'failed',
        detail: `Device "${request.deviceId}" was not found.`
      };
    }

    if (device.connected) {
      return {
        deviceId: request.deviceId,
        device,
        status: 'already_running',
        detail: `${device.name} is already connected.`
      };
    }

    return {
      deviceId: request.deviceId,
      device,
      status: 'not_startable',
      detail: `${device.name} cannot be started by the static provider.`
    };
  }

  async stopDevice(request: DeviceStopRequest): Promise<DeviceStopResult> {
    const device = this.devices.find((candidate) => candidate.id === request.deviceId);

    if (!device) {
      return {
        deviceId: request.deviceId,
        status: 'failed',
        detail: `Device "${request.deviceId}" was not found.`
      };
    }

    if (!device.connected) {
      return {
        deviceId: request.deviceId,
        device,
        status: 'already_stopped',
        detail: `${device.name} is already disconnected.`
      };
    }

    return {
      deviceId: request.deviceId,
      device,
      status: 'not_stoppable',
      detail: `${device.name} cannot be stopped by the static provider.`
    };
  }

  async runFlow(): Promise<MaestroRunFlowResult> {
    return {
      status: 'failed',
      stdout: '',
      stderr: 'Static Maestro provider cannot execute flows.',
      failureReason: 'Static Maestro provider cannot execute flows.'
    };
  }
}
