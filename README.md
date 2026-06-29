# App Auto Test Desktop

Electron + React + TypeScript + Vite baseline for the local app automation testing client.

## Current Baseline

- The Multica checkout could not resolve a default branch because the remote repository has no usable refs, so this task initializes the first local project baseline.
- Renderer, preload, main process, and shared code are split under `src/renderer`, `src/preload`, `src/main`, and `src/shared`.
- The renderer reads a read-only runtime snapshot through the preload API when running in Electron.
- Real Android/iOS execution is not a completion condition for QSC-20 because no connected=true device is available in the current environment.
- QSC-24 adds local adapters and appData storage without expanding renderer privileges. Renderer code must still call only the preload whitelist.

## Viewer URL

The original requirement mentions `http://127.0.0.1:9999/`, while the current Maestro signal observed during planning points to `http://127.0.0.1:10000/`.

The app does not hardcode port `9999`. Configure the viewer target with:

```bash
MAESTRO_VIEWER_URL=http://127.0.0.1:10000/
```

Only local viewer targets are accepted: `localhost`, `127.0.0.1`, and `::1`.

## Scripts

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

For browser-only renderer checks:

```bash
npm run dev:renderer
```

## P0 QA Acceptance

The QSC-25 P0 acceptance matrix and executable verification record are maintained
in [docs/qa-p0-acceptance.md](docs/qa-p0-acceptance.md). It separates automated
mock coverage, empty-state coverage, and the Android/iOS connected-device cases
that still require hardware or a booted simulator.

## Environment

Copy `.env.example` when local overrides are needed:

```bash
MAESTRO_VIEWER_URL=http://127.0.0.1:10000/
MAESTRO_PROVIDER=mcp
MAESTRO_APP_ID=com.example.app
AGENT_PROVIDER=codex
AGENT_COMMAND=codex
AGENT_CODEX_SERVICE_TIER=fast
RUN_TIMEOUT_MS=300000
MAX_UPLOAD_SIZE_MB=25
```

`AGENT_PROVIDER=codex` is the task execution path. The desktop app delegates uploaded YAML and natural-language task runs to `codex exec`; Codex uses an isolated Maestro MCP configuration injected by the app to drive the selected Android or iOS device.

## Local Adapters And Storage

Task execution is delegated to Codex instead of invoking `maestro test` directly. This allows Codex to use Maestro MCP for both uploaded YAML and natural-language instructions, including flows that are not valid for direct Maestro CLI execution.

Recommended local configuration:

```bash
MAESTRO_PROVIDER=mcp
AGENT_PROVIDER=codex
AGENT_COMMAND=codex
AGENT_CODEX_SERVICE_TIER=fast
```

`MAESTRO_PROVIDER=mcp` reports Maestro execution as delegated to Codex and does not require a local Maestro CLI for task runs. `MAESTRO_PROVIDER=cli` remains available for compatibility, but task runs still go through Codex. Runtime health checks do not run `maestro --version`.

Device discovery combines `adb devices -l` and `xcrun simctl list devices --json`. Android/iOS entries with `connected=false` are still shown, but run start remains blocked until a connected Android or iOS device is available.

Agent integration currently supports Codex CLI for non-interactive task execution. `AGENT_PROVIDER=codex` checks that `AGENT_COMMAND` is installed and then runs `codex exec` with the selected device, optional App ID, uploaded YAML path, and/or natural-language instruction. The Codex child process is started with `--ignore-user-config` and an explicit `maestro mcp` server based on `MAESTRO_CLI_PATH`, so unrelated user MCP servers cannot fail the test run during startup. `AGENT_CODEX_SERVICE_TIER` defaults to `fast` so older Codex configs with `service_tier = "default"` do not block test execution; set it to `flex` when needed. `AGENT_PROVIDER=manual` and `manual-ready` keep run start blocked because they cannot execute tests.

Natural-language-only task runs are passed directly to Codex. `MAESTRO_APP_ID`, a task Target App ID, or an appId in the prompt is optional launch context for Codex/Maestro MCP rather than a local pre-generation requirement.

Imported test cases and generated artifacts are stored under Electron appData by default:

```text
app-auto-test-desktop/
  testcases/
    manifest.json
  runs/
    manifest.json
  reports/
```

Use `APP_AUTO_TEST_DATA_DIR` to override the root directory in development. `MAX_UPLOAD_SIZE_MB` controls YAML import size limits. YAML imports are copied into appData and rejected when the file is empty. Zip imports are rejected in P0 until safe extraction, YAML discovery, and path traversal defenses are implemented.
