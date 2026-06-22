import { describe, expect, it } from 'vitest';

import type { ExecFile } from '../exec';
import { LocalCliMaestroProvider } from './LocalCliMaestroProvider';
import {
  parseAdbDevices,
  parseAndroidAvds,
  parseSimctlDevices,
  parseXctraceIosPhysicalDevices
} from './deviceParsers';

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
        connected: true,
        launchable: false,
        source: 'adb',
        state: 'device'
      },
      {
        id: 'R58N123',
        name: 'Galaxy S23',
        platform: 'android',
        type: 'physical',
        connected: false,
        launchable: false,
        source: 'adb',
        state: 'offline'
      }
    ]);
  });

  it('parses Android virtual devices that can be launched later', () => {
    expect(parseAndroidAvds('Pixel_8_API_35\nTablet API 35\n')).toEqual([
      {
        id: 'android-avd:Pixel_8_API_35',
        name: 'Pixel 8 API 35',
        platform: 'android',
        type: 'emulator',
        connected: false,
        launchable: true,
        source: 'android-avd',
        state: 'Shutdown'
      },
      {
        id: 'android-avd:Tablet%20API%2035',
        name: 'Tablet API 35',
        platform: 'android',
        type: 'emulator',
        connected: false,
        launchable: true,
        source: 'android-avd',
        state: 'Shutdown'
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
        connected: true,
        launchable: false,
        source: 'simctl',
        state: 'Booted'
      },
      {
        id: 'ios-shutdown',
        name: 'iPhone 15',
        platform: 'ios',
        type: 'simulator',
        connected: false,
        launchable: true,
        source: 'simctl',
        state: 'Shutdown'
      }
    ]);
  });

  it('parses connected iOS physical devices from xctrace output', () => {
    expect(
      parseXctraceIosPhysicalDevices(`== Devices ==
My Mac (15.0) (00006000-0000000000000000)
Ada's iPhone (18.1) (00008110-001C2D)
== Simulators ==
iPhone 15 (18.0) (ios-shutdown) (Simulator)
`)
    ).toEqual([
      {
        id: '00008110-001C2D',
        name: "Ada's iPhone",
        platform: 'ios',
        type: 'physical',
        connected: true,
        launchable: false,
        source: 'xctrace',
        state: 'Connected (18.1)'
      }
    ]);
  });

  it('combines Android and iOS device discovery through CLI fallbacks', async () => {
    const execFile: ExecFile = async (file, args) => {
      if (file === 'adb') {
        return {
          stdout: 'List of devices attached\nemulator-5554 device model:Pixel_8\n',
          stderr: ''
        };
      }

      if (file === 'emulator') {
        return {
          stdout: 'Pixel_8_API_35\n',
          stderr: ''
        };
      }

      if (file === 'xcrun' && args[0] === 'xctrace') {
        return {
          stdout: `== Devices ==
Ada's iPhone (18.1) (00008110-001C2D)
`,
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
      { id: 'android-avd:Pixel_8_API_35', platform: 'android', connected: false },
      { id: 'ios-booted', platform: 'ios', connected: true },
      { id: '00008110-001C2D', platform: 'ios', connected: true }
    ]);
  });

  it('starts Android virtual devices with detached emulator launch', async () => {
    const spawned: Array<{ args: string[]; file: string }> = [];
    const execFile: ExecFile = async (file, args) => {
      if (file === 'emulator') {
        return { stdout: 'Pixel_8_API_35\n', stderr: '' };
      }

      if (file === 'xcrun' && args[0] === 'simctl') {
        return { stdout: JSON.stringify({ devices: {} }), stderr: '' };
      }

      return { stdout: 'List of devices attached\n', stderr: '' };
    };
    const provider = new LocalCliMaestroProvider({
      execFile,
      spawnFile: async (file, args) => {
        spawned.push({ file, args });
      }
    });

    await expect(
      provider.startDevice({ deviceId: 'android-avd:Pixel_8_API_35' })
    ).resolves.toMatchObject({
      status: 'starting',
      device: {
        state: 'Starting'
      }
    });
    expect(spawned).toEqual([
      {
        file: 'emulator',
        args: ['-avd', 'Pixel_8_API_35']
      }
    ]);
  });

  it('boots shutdown iOS simulators through simctl', async () => {
    const calls: Array<{ args: string[]; file: string }> = [];
    const execFile: ExecFile = async (file, args) => {
      calls.push({ file, args });

      if (file === 'xcrun' && args[0] === 'simctl' && args[1] === 'list') {
        return {
          stdout: JSON.stringify({
            devices: {
              'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [
                {
                  name: 'iPhone 15',
                  udid: 'ios-shutdown',
                  state: 'Shutdown',
                  isAvailable: true
                }
              ]
            }
          }),
          stderr: ''
        };
      }

      return { stdout: '', stderr: '' };
    };
    const provider = new LocalCliMaestroProvider({ execFile });

    await expect(provider.startDevice({ deviceId: 'ios-shutdown' })).resolves.toMatchObject({
      status: 'started',
      device: {
        connected: true,
        state: 'Booted'
      }
    });
    expect(calls).toContainEqual({
      file: 'xcrun',
      args: ['simctl', 'boot', 'ios-shutdown']
    });
    expect(calls).toContainEqual({
      file: 'xcrun',
      args: ['simctl', 'bootstatus', 'ios-shutdown', '-b']
    });
  });

  it('does not try to launch physical iOS devices', async () => {
    const calls: Array<{ args: string[]; file: string }> = [];
    const execFile: ExecFile = async (file, args) => {
      calls.push({ file, args });

      if (file === 'xcrun' && args[0] === 'xctrace') {
        return {
          stdout: `== Devices ==
Ada's iPhone (18.1) (00008110-001C2D)
`,
          stderr: ''
        };
      }

      if (file === 'xcrun' && args[0] === 'simctl') {
        return { stdout: JSON.stringify({ devices: {} }), stderr: '' };
      }

      return { stdout: '', stderr: '' };
    };
    const provider = new LocalCliMaestroProvider({ execFile });

    await expect(provider.startDevice({ deviceId: '00008110-001C2D' })).resolves.toMatchObject({
      status: 'already_running'
    });
    expect(calls).not.toContainEqual({
      file: 'xcrun',
      args: ['simctl', 'boot', '00008110-001C2D']
    });
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
