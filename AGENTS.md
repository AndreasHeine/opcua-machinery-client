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
- `src/ua-machine.ts` → `src/ua-building-block.ts` + `src/ua-machine-component.ts` + `src/ua-processvalue.ts` + `src/ua-foreign-monitoring.ts` —
  per-node models. All of them share the same contract: `initialize()` (browse + read),
  `notify(nodeId, dataValue)` (fan-out from the single subscription's `changed` handler),
  `toJSON()` (the `output.json` / REST shape). `ua-machine.ts` runs the generic block loop
  (`discoverBuildingBlocks()` classifies candidate children against `ALL_BLOCK_TYPE_REFS`,
  `wireBuildingBlocks()` feeds the legacy `Identification` / `MachineryItemState` /
  `MachineryOperationMode` keys, `buildingBlockCounts()` feeds the startup summary in `ua-device.ts`)
  and the Phase 3 monitoring scan (`discoverMonitoringContent()` / `scanMonitoringSubtree()` descend
  Monitoring blocks and named-`ProcessValue*` lookalikes; chain-matched instances become `UaProcessValue`,
  everything else a `UaForeignMonitoringType` entry).
  New discovered data usually means touching all hooks plus `collectRelatedNodeIds()` /
  `collectRelatedVariableNodeIds()` / `subscribeRelatedVariableNodeIds()` in `ua-device.ts`.
- Spec registry (the single source of NodeIds and spec BrowseNames — models import from here instead
  of inlining an identifier): `src/ua-spec.ts` (namespaces, core/Machinery/DI TypeRefs, building blocks
  with per-block `SpecMember` member tables + `STATE_TABLES` StateNumbers + `candidates` BrowseName
  aliases, identification properties, server NodeIds, features), `src/ua-spec-processvalues.ts`
  (40001-2 tables), `src/ua-spec-jobs.ts` (40001-3, declared and used by the Phase 4 job model).
- Shared OPC UA layers used by the models: `src/ua-types.ts` (`UaTypeResolver`: cached
  `HasTypeDefinition` + inverse `HasSubtype` chain, `specNodeId()`, `match()`, `chainOf()`,
  `chainOfNode()`, `namespaceIndexOf()`, `formatChain()`), `src/ua-browse.ts` (`UaRef` with canonical
  NodeId strings, continuation-aware `browseChildren`, `browseComponents/Properties/AddIns/Organized/
  HierarchicalChildren`, `browseChildByBrowseName`), `src/ua-read.ts` (`readAttributes`,
  `readAttributeOfMany`, `readValue`, `normalizeValue`, `decodeRange`, `decodeEUInformation`,
  `decodeEnumValues`). The resolver is created in `ua-device.initialize()` right after the
  NamespaceArray read and passed into every model.
- `src/ua-helper.ts` — NodeId <-> string conversion and status-code acceptance.
- `src/http-server.ts` — `GET /server`, `GET /machines`, `GET /machines?productInstanceUri=`.
  Reads the in-memory summary via a getter callback; it does not read `output.json`.

## Gotchas that will bite you
- **NodeId identity is a canonical string** (`ns=<index>;i=<n>`) produced by
  `makeNodeIdStringFromExpandedNodeId()` (it accepts `NodeId | ExpandedNodeId`, because
  `ReferenceDescription.referenceTypeId` is typed as `NodeId`). Those strings key `machines`,
  `components`, `monitoring`, `_relatedNodeIds`, `_relatedVariableNodeIds`, `_dataStore`, `children`,
  and are matched against `monitoredItem.itemToMonitor.nodeId.toString()` — which always includes the
  namespace, even for namespace 0 (`ns=0;i=2256`). Every browse helper in `ua-browse.ts` returns those
  canonical strings in `UaRef.nodeId`; never key a map by a raw `ExpandedNodeId` (it stringifies as
  `ns=N;i=X;namespaceUri:<uri>` and never matches). (`nsu=` only appears if you pass a
  `namespaceArray` option to `NodeId.toString()`, which this code never does.)
- **A browse request must set `resultMask`** (`ua-browse.ts` sends 63). Without it the demo server
  answers with bare NodeIds — `browseName` null, `nodeClass` 0, `referenceTypeId` `ns=0;i=0` — so every
  BrowseName/NodeClass filter silently matches nothing and the client ends up monitoring nothing.
- `subscription.monitorItems([])` is always rejected with `BadNothingToDo (0x800f0000)`, which the init
  path turns into a process exit. `OpcUaDeviceProxyClass.subscribeRelatedVariableNodeIds()` guards
  against an empty set and chunks the rest below `MaxMonitoredItemsPerCall` /
  `MaxMonitoredItemsPerSubscription` minus `SUBSCRIPTION_SLACK`.
- Hardcoded OPC constants live in `src/ua-spec*.ts` (the only place NodeIds and spec BrowseNames are
  declared): namespace URIs `http://opcfoundation.org/UA/Machinery/` and
  `.../Machinery/ProcessValues/`, Machines folder NodeId `ns=<machineryIndex>;i=1001`, server variables
  `i=2256 / 2259 / 2267 / 2255 / 2269`, operational limits `i=24098 / 24104 / 11714 / 11709 / 11705 /
  11712 / 11707`.
- Type definition classification is by **`HasSubtype` chain** (`UaTypeResolver` in `ua-types.ts`), not by
  DisplayName string: `HasTypeDefinition` is resolved once, cached, and the chain is compared against
  the spec TypeRefs from `ua-spec*.ts`, so vendor subtypes such as
  `MachineOperationModeStateMachineType [ns=5;i=1003] <- MachineryOperationModeStateMachineType
  [ns=3;i=1008] <- ...` match. `UaProcessValue.classifyInstance()` **throws** when the chain does not
  reach `ProcessValueType` — that throw is the filter contract: `UaMachineryMachine.loadProcessValue()`
  catches it and logs a warning, so keep the try/catch around discovery.
- Building blocks (§2 Phase 2): `discoverBuildingBlocks()` in `ua-machine.ts` classifies every candidate
  against `ALL_BLOCK_TYPE_REFS`. A candidate that only matches a block **BrowseName or alias** (`Equipment`,
  singular `Notification`) but whose chain misses the spec TypeRef is still loaded and lands under
  `BuildingBlocks.Foreign` with its TypeDefinition chain — a server deviation, never claimed as coverage
  (`MatchedSpecType: null`, count key `foreign:<block>`). Block members are keyed by **BrowseName** (the
  legacy `Identification` map is wired from them via `wireBuildingBlocks()`; keys changed from DisplayName
  to BrowseName — identical on the demo server). Machine-level Methods (`SetMachineTime`, `SetMESMessage`,
  ...) are filtered out by NodeClass before classification and are never read or called. §12/§13 state
  Objects + transitions exist only on the TypeDefinition; the instance only carries `CurrentState`, so
  `FoundStates` is normally empty and `SpecStates` (from `STATE_TABLES`) is the spec truth.
- Monitoring / Process Values (Phase 3): `discoverMonitoringContent()` in `ua-machine.ts` starts from the
  block results (candidates with `spec.key === "monitoring"`, matched **or** foreign) plus direct children
  named `ProcessValue*` (`PROCESS_VALUE_INSTANCE_NAME_PREFIX` — vendor lookalikes like the demo's
  `ProcessValue_1/_2` are classified, never silently skipped). `scanMonitoringSubtree()` descends only
  §16.2 Table 41 subfolders (derived from the monitoring block's `members` = `Status`/`Health`/`Process`/
  `Consumption`) or FolderType-chained Objects, bounded at depth 2; anything not chain-matched to the
  ProcessValues `ProcessValueType` lands in `ForeignMonitoringTypes` (`UaForeignMonitoringType`: TypeDefinition
  chain + direct Variable values read once, **never subscribed** — the old early-return when the
  ProcessValues namespace was absent is gone, foreign namespaces are now reported instead). PV candidates
  are **not** filtered by NodeClass: real PV instances on the demo server (`ns=50;s=MyMachine`) are
  Object nodes under a BaseObjectType-typed Monitoring folder. `UaProcessValue` classifies every child
  against the registry tables (`PROCESS_VALUE_CHILDREN` / `ANALOG_SIGNAL_CHILDREN` /
  `ANALOG_SIGNAL_PROPERTIES` / `SETPOINT_CHILDREN`): BrowseName picks the entry, the chain decides
  `SpecMatch`; standardized enum labels come from the child's **EnumValues Property** plus the
  `PROCESS_VALUE_*_ENUMS` tables (never decode the Value as an enum array); alarm Objects and Methods are
  reported (InputArgs/OutputArgs read, never called, never subscribed).
- Startup logs are noisy by design, not a bug. Against `opcua.umati.app:4843` the client finds 24
  machines, prints one `Machine '<id>' type chain: ...` line per machine and the
  `building blocks of '24' machines: components=5 foreign:equipment=7 ... identification=24 itemState=10
  operationCounters=1 operationMode=9` summary, and at `LOG_LEVEL=debug` several dozen lines such as
  `foreign monitoring 'ns=30;i=5018' TypeDefinition='ChannelMonitoringType'`. On that server only ~9
  machines expose a non-null `MachineryItemState`, only 1 machine has real `Monitoring` entries (2
  ProcessValues) and 9 machines report `ForeignMonitoringTypes` (~33 entries), so sparse output is
  normal. Verify a change by comparing `GET /machines` and `output.json` before/after, not by log silence.
- Status codes: model files read through `ua-read.ts`, whose `DecodedValue.ok` is
  `isStatusCodeGoodish()` (Good plus several `Uncertain*` codes), and `statusCodeIsUncertain` marks the
  rest. `ua-device.ts` still mixes `isStatusCodeGoodish()` with direct
  `statusCode.value === StatusCodes.Good.value` comparisons. Match the surrounding file rather than
  "fixing" it globally.
- The process exits on purpose: `uncaughtException`/`unhandledRejection` → `process.exit(1)`;
  init failure → `process.exit(-1)`; bad `ServerState` or `ServiceLevel <= 200` re-runs
  `initialize()` every 10s. Any new unhandled promise rejection can kill the app.
- `output.json` is written with a relative path, so it lands in the **process CWD**, not the repo root.
- Tuning lives at the top of `ua-device.ts`: `optionsInitial` (session timeout, keep-alive, reconnect
  strategy) and `createSubscriptionRequest` (publishing interval from `PUBLISHING_INTERVAL_MS`). There
  is a single subscription for everything; `subscribeRelatedVariableNodeIds()` keeps monitored items
  below `MaxMonitoredItemsPerCall` and `MaxMonitoredItemsPerSubscription - SUBSCRIPTION_SLACK` and
  splits the request into `MAX_MONITORED_ITEMS_PER_REQUEST` chunks.

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
