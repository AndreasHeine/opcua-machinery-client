# AGENTS.md

Compact guidance for working in this repo. Read `README.md` for user-facing docs.

## What this is
Single-package TypeScript OPC UA **client** (no monorepo, no framework, no web UI). It
connects to an OPC UA server, discovers OPC 40001 Machinery instances, subscribes to their
variables, writes a snapshot to `output.json` every 10s, and serves a read-only Express API.

## Commands
- `npm start` — builds with `tsc` and runs `node dst/src/main.js`. A reachable OPC UA server is required.
- `npm run build` — plain `tsc`. **This is the only built-in verification.** There is no test
  suite, no linter, no formatter, no CI. Do not look for `npm test`.
- `ts-node` is in devDependencies but **cannot work** with `typescript@7`: the package main-exports
  only `version` / `versionMajorMinor` (`node_modules/typescript/lib/version.cjs`), so ts-node dies with
  `TypeError: Cannot read properties of undefined (reading 'fileExists')`. Never wire a script to ts-node.
- `npm run update:node-opcua` — deletes `node_modules`, runs `npm-check-updates` filtered to
  `node-opcua*`, reinstalls. Prefer this over editing the `node-opcua` pin by hand.

## Entry points and ownership
- `src/main.ts` — only entrypoint: builds `OpcUaDeviceProxyClass`, starts the HTTP server,
  installs SIGINT/SIGTERM shutdown.
- `src/ua-device.ts` — owns connection, session, one shared subscription, server-status/limits
  reads, machine discovery, the 10s `output.json` refresh and the 60s machine re-scan.
- `src/ua-machine.ts` → `src/ua-machine-component.ts` + `src/ua-processvalue.ts` — per-node
  models. All three share the same contract: `initialize()` (browse + read),
  `notify(nodeId, dataValue)` (fan-out from the single subscription's `changed` handler),
  `toJSON()` (the `output.json` / REST shape). New discovered data usually means touching all
  three hooks plus `collectRelatedNodeIds()` / `collectRelatedVariableNodeIds()` in `ua-device.ts`.
- `src/ua-helper.ts` — NodeId <-> string conversion and status-code acceptance.
- `src/http-server.ts` — `GET /server`, `GET /machines`, `GET /machines?productInstanceUri=`.
  Reads the in-memory summary via a getter callback; it does not read `output.json`.

## Gotchas that will bite you
- **NodeId identity is a canonical string** (`ns=<index>;i=<n>`) produced by
  `makeNodeIdStringFromExpandedNodeId()`. Those strings key `machines`, `monitoring`,
  `_relatedNodeIds`, `_relatedVariableNodeIds`, `_dataStore`, and are matched against
  `monitoredItem.itemToMonitor.nodeId.toString()` — which always includes the namespace, even for
  namespace 0 (`ns=0;i=2256`). The one exception is `components` (`ua-machine.ts`): its map key is
  the raw browse-result `ExpandedNodeId`, which stringifies as `ns=N;i=X;namespaceUri:<uri>` and
  never matches the canonical form. Nothing calls `components.get()` today, so this is latent; add a
  key lookup and it becomes a real bug. (`nsu=` only appears if you pass a `namespaceArray` option to
  `NodeId.toString()`, which this code never does.)
- Hardcoded OPC constants: namespace URIs `http://opcfoundation.org/UA/Machinery/` and
  `.../Machinery/ProcessValues/` (discovery returns early if absent), Machines folder NodeId
  `ns=<machineryIndex>;i=1001`, server variables `i=2256 / 2259 / 2267 / 2255 / 2269`, operational
  limits `i=24098 / 24104 / 11714 / 11709 / 11705 / 11712 / 11707`.
- TypeDefinition matching is by **DisplayName string** (`"ProcessValueType"`,
  `"MachineryItemState_StateMachineType"`, `"MachineryOperationModeStateMachineType"` plus a few
  vendor subtypes). `UaProcessValue.initialize()` uses `assert()` as its type filter — callers
  rely on catching that as a warning, so don't remove the try/catch around discovery.
- Loud startup logs are expected, not a bug. Against `opcua.umati.app:4843` the client finds 24
  machines and prints many lines such as
  `error while loading ProcessValue -> NodeId='ns=30;i=5018' with TypeDefinition='ChannelMonitoringType' !== 'ProcessValueType' skipping node!`
  from that `assert()`. On that server only ~9 machines expose `MachineryItemState` and only 1 has
  `Monitoring` entries, so sparse output is normal. Verify a change by comparing
  `GET /machines` and `output.json` before/after, not by log silence.
- Status-code acceptance is inconsistent between files: `isStatusCodeGoodish()` also accepts
  several `Uncertain*` codes, while `ua-machine.ts` / `ua-machine-component.ts` /
  `ua-processvalue.ts` often compare `statusCode.value === StatusCodes.Good.value`. Match the
  surrounding file rather than "fixing" it globally.
- The process exits on purpose: `uncaughtException`/`unhandledRejection` → `process.exit(1)`;
  init failure → `process.exit(-1)`; bad `ServerState` or `ServiceLevel <= 200` re-runs
  `initialize()` every 10s. Any new unhandled promise rejection can kill the app.
- `output.json` is written with a relative path, so it lands in the **process CWD**, not the repo root.
- Tuning lives at the top of `ua-device.ts`: `optionsInitial` (session timeout, keep-alive,
  reconnect strategy) and `createSubscriptionRequest` (5000ms publishing interval). There is a
  single subscription for everything, and the monitored-item capacity check reserves 10 slots
  (`maxPerSub - 10`).

## Configuration and environment
- All runtime config is env-driven via `src/config.ts` (`OPCUA_ENDPOINT`, `PORT`, `OUTPUT_FILE`,
  `REFRESH_INTERVAL_MS`, `RESCAN_INTERVAL_MS`, `PUBLISHING_INTERVAL_MS`, `SAMPLING_INTERVAL_MS`,
  `SUBSCRIPTION_SLACK`, `MAX_MONITORED_ITEMS_PER_REQUEST`, `INIT_RETRY_DELAY_MS`, `LOG_LEVEL`,
  optional `OPCUA_USERNAME` / `OPCUA_PASSWORD`). Default endpoint:
  `opc.tcp://opcua.umati.app:4843` (the public umati demo). No dotenv is loaded.
- Identity defaults to `UserTokenType.Anonymous` with no security policy or client certificate.
  This is a demo tool; do not "improve" it into a hardened client.
- HTTP port: `process.env.PORT || 3000`.
- Docker: the Dockerfile sets `ENV PORT=8080` and `EXPOSE 8080`, so the documented
  `docker run -p 3000:3000` in `README.md` does not match the image — use `-p 8080:8080`.

## Toolchain and dependencies
- Node 26 in Docker (`node:26-bookworm-slim`); `@types/node` is pinned to 26.6.6, while `README.md`
  still claims "Node.js 18+".
- `node-opcua` (2.187.26), `typescript` (7.0.2) and `@types/node` are pinned with no caret. Renovate
  owns dependency PRs (`renovate.json` = `config:recommended`); expect branches named `renovate/*`.
- `typescript@7` is the native compiler port: `tsc` works, but the legacy JS compiler API is no longer
  reachable from `require("typescript")`. Any tool built on it (ts-node, and similar) breaks on install.
- `node-opcua` changes shape between minor releases. After any bump, re-check the imports in
  every `src/*.ts` and run `npm run build`.

## Workflow
Open a pull request into `main`; do not commit dependency bumps directly to `main` — Renovate
owns those.

## Generated, gitignored, never hand-edit
`dst/` (tsc output), `output.json` (runtime snapshot), `node_modules/`.
