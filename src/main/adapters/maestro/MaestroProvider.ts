import type { DeviceInfo, ServiceHealth, TestRunStatus } from '../../../shared/types';

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

  async runFlow(): Promise<MaestroRunFlowResult> {
    return {
      status: 'failed',
      stdout: '',
      stderr: 'Static Maestro provider cannot execute flows.',
      failureReason: 'Static Maestro provider cannot execute flows.'
    };
  }
}
