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
AGENT_PROVIDER=manual-ready
RUN_TIMEOUT_MS=300000
MAX_UPLOAD_SIZE_MB=25
```

`MAESTRO_PROVIDER` controls the CLI fallback mode. `AGENT_PROVIDER=manual-ready` keeps Agent control conservative: the app records the user's Agent instruction and requires manual confirmation that the local Agent dialogue is available, but it does not auto-launch or control Codex/Cursor.

## Local Adapters And Storage

The desktop main process cannot directly call the ChatGPT-hosted Maestro MCP tool. The P0 local adapter therefore uses a configurable CLI fallback:

```bash
MAESTRO_PROVIDER=cli
MAESTRO_CLI_PATH=maestro
```

Device discovery combines `adb devices -l` and `xcrun simctl list devices --json`. Android/iOS entries with `connected=false` are still shown, but run start remains blocked until a connected Android or iOS device is available.

Agent integration is intentionally conservative. `AGENT_PROVIDER=manual-ready` marks the Agent side ready only as an explicit manual-confirmation mode; `AGENT_PROVIDER=manual` keeps run start blocked. If `AGENT_COMMAND` is configured with another provider name, the app checks command availability and reports the mode as degraded because no automated message transport is opened.

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
