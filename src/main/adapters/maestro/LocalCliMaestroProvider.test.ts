import { describe, expect, it } from 'vitest';

import type { ExecFile } from '../exec';
import { LocalCliMaestroProvider } from './LocalCliMaestroProvider';
import { parseAdbDevices, parseSimctlDevices } from './deviceParsers';

describe('Maestro local CLI adapter', () => {
  it('reports a clear disconnected health state when Maestro CLI is unavailable', async () => {
    const execFile: ExecFile = async () => {
      throw new Error('maestro not found');
    };
    const provider = new LocalCliMaestroProvider({ execFile });

    await expect(provider.health()).resolves.toMatchObject({
      status: 'disconnected',
      detail: expect.stringContaining('maestro not found')
    });
  });

  it('parses Android devices including disconnected entries', () => {
    expect(
      parseAdbDevices(`List of devices attached
emulator-5554 device product:sdk model:Pixel_8 device:emu transport_id:1
R58N123 offline usb:123 model:Galaxy_S23 device:dm3q
`)
    ).toEqual([
      {
        id: 'emulator-5554',
        name: 'Pixel 8',
        platform: 'android',
        type: 'emulator',
        connected: true
      },
      {
        id: 'R58N123',
        name: 'Galaxy S23',
        platform: 'android',
        type: 'physical',
        connected: false
      }
    ]);
  });

  it('parses iOS simulators and keeps shutdown devices non-executable', () => {
    expect(
      parseSimctlDevices(
        JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
              {
                name: 'iPhone 16',
                udid: 'ios-booted',
                state: 'Booted',
                isAvailable: true
              },
              {
                name: 'iPhone 15',
                udid: 'ios-shutdown',
                state: 'Shutdown',
                isAvailable: true
              }
            ]
          }
        })
      )
    ).toEqual([
      {
        id: 'ios-booted',
        name: 'iPhone 16',
        platform: 'ios',
        type: 'simulator',
        connected: true
      },
      {
        id: 'ios-shutdown',
        name: 'iPhone 15',
        platform: 'ios',
        type: 'simulator',
        connected: false
      }
    ]);
  });

  it('combines Android and iOS device discovery through CLI fallbacks', async () => {
    const execFile: ExecFile = async (file) => {
      if (file === 'adb') {
        return {
          stdout: 'List of devices attached\nemulator-5554 device model:Pixel_8\n',
          stderr: ''
        };
      }

      return {
        stdout: JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
              {
                name: 'iPhone 16',
                udid: 'ios-booted',
                state: 'Booted',
                isAvailable: true
              }
            ]
          }
        }),
        stderr: ''
      };
    };
    const provider = new LocalCliMaestroProvider({ execFile });

    await expect(provider.listDevices()).resolves.toMatchObject([
      { id: 'emulator-5554', platform: 'android', connected: true },
      { id: 'ios-booted', platform: 'ios', connected: true }
    ]);
  });

  it('runs Maestro flows with the documented udid selector', async () => {
    const calls: Array<{ args: string[]; file: string }> = [];
    const execFile: ExecFile = async (file, args) => {
      calls.push({ file, args });

      return { stdout: 'ok', stderr: '' };
    };
    const provider = new LocalCliMaestroProvider({ execFile });

    await expect(
      provider.runFlow({
        deviceId: 'emulator-5554',
        flowPath: '/tmp/smoke.yaml'
      })
    ).resolves.toMatchObject({
      status: 'succeeded'
    });
    expect(calls).toEqual([
      {
        file: 'maestro',
        args: ['--udid=emulator-5554', 'test', '/tmp/smoke.yaml']
      }
    ]);
  });

  it('passes cancellation signals to the underlying Maestro command', async () => {
    const abortController = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const execFile: ExecFile = async (_file, _args, options) => {
      receivedSignal = options?.signal;

      return { stdout: 'ok', stderr: '' };
    };
    const provider = new LocalCliMaestroProvider({ execFile });

    await provider.runFlow({
      deviceId: 'emulator-5554',
      flowPath: '/tmp/smoke.yaml',
      signal: abortController.signal
    });

    expect(receivedSignal).toBe(abortController.signal);
  });
});
