# QSC-25 P0 Acceptance Matrix And QSC-26 Regression

Date: 2026-06-16
Last regression: 2026-06-16 14:15 Asia/Shanghai

Scope: QSC-19 P0 desktop client implementation in local worktree
`app-auto-test-desktop`, branch `feature/qsc-20-initialize-desktop-baseline`.
This report covers the completed coding chain through QSC-21 and separates
automated verification, mock verification, empty-state verification, and
connected-device follow-up. It was updated after the QSC-26 must-fix remediation
for renderer URL loading, Agent readiness, cancellation, zip import policy, and
report redaction.

## Environment Snapshot

| Item | Result |
| --- | --- |
| Node.js | `v24.6.0` |
| npm | `11.5.1` |
| Maestro CLI | `2.6.0` |
| Android device probe | `adb devices -l` returned no devices |
| iOS simulator probe | `xcrun simctl list devices available` returned iOS 18.6 and iOS 26.3 simulators; all available entries were `Shutdown` |
| Connected Android/iOS device | Not available in this environment |
| Viewer probe | GET `http://127.0.0.1:10000/` returned `200`; GET `http://127.0.0.1:9999/` returned `200`; HEAD returned `405` on both ports |

## Executed Verification

| Command | Result | Notes |
| --- | --- | --- |
| `npm ci` | Pass | Installed 188 packages from `package-lock.json` for local verification |
| `npm test` | Pass | 15 test files, 53 assertions |
| `npm run build` | Pass | Typecheck and Electron/Vite main, preload, renderer builds passed |
| `npm run dev:renderer -- --port 5174` | Pass | Vite served renderer at `http://127.0.0.1:5174/` |
| `curl -I http://127.0.0.1:5174/` | Pass | Returned `HTTP/1.1 200 OK`; dev server was stopped after the smoke check |
| `adb devices -l` | Boundary confirmed | No Android devices attached |
| `xcrun simctl list devices available` | Boundary confirmed | Simulators exist but all available entries are `Shutdown`; no Booted simulator target |
| `curl GET 127.0.0.1:10000` and `127.0.0.1:9999` | Pass | Both local ports responded with `200`; HEAD returned `405`; code still keeps viewer URL configurable |

## QSC-26 Must-Fix Regression Matrix

| ID | Fixed risk | Acceptance criteria | Evidence | Status |
| --- | --- | --- | --- | --- |
| MF-01 | Renderer URL escalation | `ELECTRON_RENDERER_URL` can load only localhost/127.0.0.1/::1 in unpackaged development; packaged builds always load bundled renderer files | `src/main/rendererEntryPolicy.test.ts`, `src/main/index.ts` | Pass |
| MF-02 | Remote renderer preload exposure | Non-local renderer URLs fall back to bundled renderer before preload APIs are exposed to that page | `src/main/rendererEntryPolicy.test.ts`, `src/preload/createAppAutoTestApi.test.ts` | Pass |
| MF-03 | Agent readiness dead end | `manual-ready` is explicit and ready, `manual` still blocks, and command-based providers are degraded rather than treated as stable message transports | `src/main/adapters/agent/LocalAgentProvider.test.ts`, `src/main/services/TestRunService.test.ts` | Pass |
| MF-04 | Degraded Agent execution policy | Ready/degraded Agent states may start a run with recorded detail; not configured/disconnected Agent states still return `AGENT_NOT_AVAILABLE` | `src/main/services/TestRunService.test.ts`, `src/main/services/EnvironmentService.ts` | Pass |
| MF-05 | Cancel does not stop Maestro | `runs.cancel` aborts the run's `AbortSignal`, cancellation reason records that termination was sent, and late Maestro success cannot overwrite `cancelled` | `src/main/services/TestRunService.test.ts`, `src/main/adapters/maestro/LocalCliMaestroProvider.test.ts` | Pass |
| MF-06 | Zip false-positive import | `.zip` imports are rejected in P0 before copy/manifest creation; renderer validation also limits uploads to `.yaml/.yml` | `src/main/services/TestCaseService.test.ts`, `src/renderer/src/workbenchModel.test.ts` | Pass |
| MF-07 | Report sensitive data exposure | Prompt, failure reason, target/case labels, stdout, stderr, and Markdown export redact tokens, authorization headers, passwords, common secrets, and user home paths | `src/main/services/ReportService.test.ts`, `src/main/services/ReportService.ts` | Pass |

## P0 Acceptance Matrix

| ID | P0 area | Acceptance criteria | Verification type | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| P0-01 | Environment detection | App reports Agent, Maestro, Viewer, blockers, capabilities, and `canStartRun` without exposing shell or fs to renderer | Automated | `src/main/ipc/ipcHandlers.test.ts`, `src/shared/runtimeSnapshot.test.ts` | Pass |
| P0-02 | Maestro unavailable | Start is blocked with a clear `MAESTRO_NOT_AVAILABLE` error when Maestro is disconnected | Mock automated | `src/main/services/TestRunService.test.ts` | Pass |
| P0-03 | Agent unavailable | Start is blocked with a clear `AGENT_NOT_AVAILABLE` error when local agent transport is not ready | Mock automated | `src/main/services/TestRunService.test.ts`, `src/main/adapters/agent/LocalAgentProvider.test.ts` | Pass |
| P0-04 | Device discovery | Android and iOS discovery preserves disconnected entries but only connected Android/iOS devices are executable | Automated plus environment probe | `src/main/adapters/maestro/LocalCliMaestroProvider.test.ts`; `adb` and `simctl` probes | Pass with device boundary |
| P0-05 | No connected device empty state | UI and service prevent execution when the selected device is disconnected or no connected Android/iOS device exists | Automated empty-state | `src/renderer/src/workbenchModel.test.ts`, `src/renderer/src/App.test.tsx`, `src/main/services/TestRunService.test.ts` | Pass |
| P0-06 | Multiple device selection | Run readiness requires an explicit selected connected Android/iOS device | Mock automated | `src/renderer/src/workbenchModel.test.ts`, `src/main/adapters/maestro/LocalCliMaestroProvider.test.ts` | Pass |
| P0-07 | Viewer URL configuration | Viewer URL is configurable; default falls back to observed Maestro URL `10000`; original `9999` remains an allowed local override | Automated plus curl | `src/shared/viewerConfig.test.ts`; curl GET to both ports returned `200` | Pass |
| P0-08 | Viewer URL safety | Non-local viewer URLs are rejected before renderer or main process opens/probes them | Automated | `src/shared/viewerConfig.test.ts`, `src/main/services/viewerService.test.ts`, `src/main/windowOpenPolicy.test.ts`, `src/renderer/src/App.test.tsx` | Pass |
| P0-09 | Test case upload success | YAML import copies the source into appData and writes a manifest | Automated | `src/main/services/TestCaseService.test.ts` | Pass |
| P0-10 | Test case upload failure | Empty YAML, unsupported extensions, and oversized files are rejected before becoming runnable cases | Automated | `src/main/services/TestCaseService.test.ts`, `src/renderer/src/workbenchModel.test.ts` | Pass |
| P0-11 | Dialog-triggered run start | Run start requires case, device, prompt, ready Agent, ready/degraded Maestro, and connected Android/iOS device | Mock automated | `src/main/services/TestRunService.test.ts`, `src/renderer/src/workbenchModel.test.ts` | Pass for mock; real device pending |
| P0-12 | Run state machine | Run moves through queued/running to succeeded, failed, timeout, or cancelled and persists state before in-memory update | Mock automated | `src/main/services/TestRunService.test.ts` | Pass |
| P0-13 | Cancel safety | A cancelled run aborts the underlying Maestro command signal and remains cancelled even if Maestro resolves later with success | Mock automated | `src/main/services/TestRunService.test.ts`, `src/main/adapters/maestro/LocalCliMaestroProvider.test.ts` | Pass |
| P0-14 | Report generation | Report contains run, status, target device, case, prompt, start/end time, conclusion, failure reason, stdout, and stderr when available | Automated | `src/main/services/ReportService.test.ts`, `src/renderer/src/App.test.tsx` | Pass |
| P0-15 | Markdown report export | Report export writes Markdown under appData reports | Automated | `src/main/services/ReportService.test.ts` | Pass |
| P0-16 | IPC whitelist | Renderer only receives fixed preload API namespaces and cannot invoke arbitrary IPC channels | Automated | `src/preload/createAppAutoTestApi.test.ts`, `src/main/ipc/ipcHandlers.test.ts` | Pass |
| P0-17 | Local command/file boundary | Renderer does not receive shell/fs APIs; uploads and report export are routed through whitelisted main services | Automated review plus tests | `src/preload/createAppAutoTestApi.test.ts`, `src/main/ipc/ipcHandlers.test.ts`, `src/main/services/TestCaseService.test.ts` | Pass |
| P0-18 | Renderer entry policy | Development renderer URL is local-only and production/packaged builds ignore `ELECTRON_RENDERER_URL` | Automated | `src/main/rendererEntryPolicy.test.ts` | Pass |
| P0-19 | P0 zip policy | Zip is explicitly out of P0 support and rejected up front instead of becoming a delayed Maestro failure | Automated | `src/main/services/TestCaseService.test.ts`, `src/renderer/src/workbenchModel.test.ts` | Pass |
| P0-20 | Report redaction | Page and Markdown report surfaces redact secrets and local user paths before returning/exporting report content | Automated | `src/main/services/ReportService.test.ts` | Pass |

## Mock, Empty-State, And Connected-Device Boundary

Current pass scope:

- Mock-verified: Agent health, Maestro health, run success, run failure, timeout,
  cancellation with abort signal, manual-ready/degraded Agent policy, and report
  content redaction.
- Empty-state verified: no connected Android/iOS device blocks run start at service
  and renderer readiness levels; disconnected devices render as disabled targets.
- Local executable verification: unit tests, typecheck/build, renderer HTTP serving,
  viewer URL local-only validation, local upload/report file handling.
- Upload scope verified: YAML/YML import only; zip and directories remain out of
  P0 and must not be described as supported until safe extraction and flow
  discovery are implemented.

Not claimed as passed:

- Real Android app execution through `maestro --udid=<android-device> test <flow>`.
- Real iOS simulator or device execution through Maestro.
- Live device viewer rendering for a selected connected device. Local viewer ports
  responding with HTTP `200` only proves local page reachability, not that a live
  device is visible.
- Fully automated local Agent conversation transport. `manual-ready` is an
  explicit manual-confirmation mode; command detection is degraded and does not
  auto-launch or control Codex/Cursor.

## Connected-Device Follow-Up Checklist

Run these when at least one Android device is listed as `device` by
`adb devices -l` or at least one iOS simulator is `Booted` by `xcrun simctl list
devices available`.

| ID | Follow-up case | Steps | Expected result |
| --- | --- | --- | --- |
| CD-01 | Android connected discovery | Attach/boot Android device, open app, refresh device list | Device appears with `connected=true` and execution target is enabled after selection |
| CD-02 | iOS connected discovery | Boot iOS simulator or attach device, refresh device list | Device appears with `connected=true` and execution target is enabled after selection |
| CD-03 | Android Maestro flow | Import valid YAML, select Android device, enter prompt, start run | Run reaches `succeeded` or `failed` based on real Maestro result; report records stdout/stderr and device metadata |
| CD-04 | iOS Maestro flow | Import valid YAML, select iOS device, enter prompt, start run | Run reaches terminal state and report records real iOS target metadata |
| CD-05 | Device disconnect during run | Start run and disconnect/stop selected device during execution | Run becomes `failed` or `timeout`; report includes failure reason and does not show success |
| CD-06 | Viewer with selected device | Start/confirm Maestro viewer service, open configured viewer URL from workbench | Viewer opens only for localhost URL and shows the live device view |
| CD-07 | Multi-device selection | Connect at least two executable devices, select each in turn | Run request uses the selected device id and does not silently choose another device |
| CD-08 | Cancel real Maestro process | Start a long-running real device flow and cancel from the UI | UI/report remain `cancelled`, the Maestro process stops, and the target device is no longer executing the flow |
| CD-09 | Report redaction with real logs | Run a real flow whose stdout/stderr includes benign fake token/password/path strings | Page and exported Markdown redact those strings while preserving useful failure context |

## QA Conclusion

QSC-25 P0 acceptance plus the QSC-26 must-fix regression are passed for
automated, mock, empty-state, local file, IPC, renderer URL, Agent readiness,
cancel signal, zip rejection, viewer URL, state machine, and report-redaction
coverage. The real Android/iOS App execution loop remains blocked by the current
environment because there is no connected executable device or Booted iOS
simulator. That gap is explicitly tracked in the connected-device follow-up
checklist and must not be treated as completed until CD-01 through CD-09 are run
on real connected devices or a Booted simulator.
