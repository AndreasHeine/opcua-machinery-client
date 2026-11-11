# opcua-machinery-client

A read-only OPC UA Machinery client and reference demo for the OPC 40001 series
(40001-1 Basic Building Blocks, 40001-2 Process Values, 40001-3 Job Management), focused on end users.

## What this program does

This client connects to an OPC UA server and automatically discovers machines that follow the OPC UA
Machinery model. It classifies every discovered node through its TypeDefinition `HasSubtype` chain
(not display names), so vendor subtypes are recognized and vendor deviations are reported as *foreign*
instead of being claimed as spec coverage.

It collects:

- Server health, capability and limits information
- List of available machines (Machinery `Machines` folder)
- Machine identification / nameplate data and component identification
- Building blocks: MachineryItemState, MachineryOperationMode, OperationCounters, LifetimeCounters,
  Monitoring, MachineryEquipment, Notifications
- Process values (OPC 40001-2): values, ranges, engineering units, limits, status enums, setpoints —
  subscribed and live
- Job management (OPC 40001-3, read side): JobManagement AddIns, JobOrderControl / JobOrderResults
  containers with their ISA-95 list variables; methods are reported with their arguments, never called
- Foreign/vendor types encountered below any of the above (namespace-qualified)
- A per-spec **coverage report**: which OPC 40001-1 / -2 / -3 features this server implements,
  as deviations, or not at all

All collected data is written to `output.json` and refreshed every 10 seconds; the same data is
available through a small read-only REST API.

**Read-only by design:** this tool never writes any value, never calls any Method, and never changes
the server. Security (user auth beyond simple username/password, security policies, certificates) is
explicitly out of scope — it is a demo/reference tool, not a hardened client.

## Why this is useful for end users

This project is useful when you want a clear, ready-to-use view of machine data without manually
browsing an OPC UA address space.

Main benefits:

- Quick onboarding: see machine data in one JSON file
- Easy integration: `output.json` can be consumed by scripts, dashboards, or data pipelines
- Live updates: values are subscribed and updated continuously
- Better reliability: reconnect, model-change-event handling, and periodic address-space re-scans
  are built in
- Server fingerprint in one call: `GET /coverage` answers "what does this server implement" of the
  OPC 40001 specs, including counts of deviations (foreign types)

In short, it turns a complex OPC UA server structure into a simple, machine-readable snapshot for
operations, diagnostics, and integration work.

## How it works (in plain language)

1. Connects to the OPC UA endpoint (anonymous by default).
2. Reads server status, namespaces, limits, and builds a cached TypeDefinition chain resolver.
3. Finds machine instances in the Machinery `Machines` folder (OPC 40001-1 §9).
4. Discovers each machine's building blocks, components, process values, and job management —
   chain-matched against the spec type tables in `src/ua-spec*.ts`.
5. Subscribes to all modelled Variables in a single subscription, respecting the server's
   monitored-item limits.
6. Listens for `BaseModelChange` / `GeneralModelChange` / `SemanticChange` events: machines are
   re-discovered or removed and monitored items kept in sync; new machines are picked up by the
   60-second re-scan as well.
7. Writes and refreshes `output.json` every 10 seconds and serves the REST API.

## Quick start

### Requirements

- Node.js 22.13+ (`node-opcua` requires `>= 22.13.0`; developed on Node 24, Docker image uses Node 26)
- npm

### Install and run

```bash
npm install
npm start
```

`npm start` builds with `tsc` and runs the client. A reachable OPC UA server is required.
After startup, check `output.json` in the current working directory (`OUTPUT_FILE` overrides the path).

Startup prints discovery summaries like:

```text
OPC UA Client: building blocks of '24' machines: components=5 ... itemState=10 operationMode=9
OPC UA Client: job management of '24' machines: foreign:jobs=1 jobs=1
OPC UA Client: coverage 'OPC 40001-1' (Machinery Basic Building Blocks): found=7 foreign-only=3 missing=1 client-side=1 of '12' features
OPC UA Client: coverage 'OPC 40001-2' (Machinery Process Values): found=5 foreign-only=0 missing=12 of '17' features
OPC UA Client: coverage 'OPC 40001-3' (Machinery Job Management): found=11 foreign-only=0 missing=1 of '12' features
```

(The default demo server implements only parts of the specs — sparse coverage lines are normal and
are the point of the report.)

### Run with Docker

Build the image:

```bash
docker build -t opcua-machinery-client .
```

Start the container (the image serves HTTP on port **8080**):

```bash
docker run --rm -p 8080:8080 opcua-machinery-client
```

If you want to persist the generated JSON file on the host, mount a file at the container's
`/app/output.json`:

```bash
touch output.json
docker run --rm -p 8080:8080 -v "$PWD/output.json:/app/output.json" opcua-machinery-client
```

## Configuration

All runtime configuration is environment-driven (see `src/config.ts`) — nothing has to be edited in
the source:

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `OPCUA_ENDPOINT` | `opc.tcp://opcua.umati.app:4843` | OPC UA server endpoint (the public umati demo) |
| `OPCUA_USERNAME` / `OPCUA_PASSWORD` | unset (anonymous) | simple username identity, if the server accepts it |
| `PORT` | `3000` (Docker image: `8080`) | HTTP API port |
| `OUTPUT_FILE` | `output.json` | snapshot file path (relative to the process CWD) |
| `REFRESH_INTERVAL_MS` | `10000` | snapshot write interval |
| `RESCAN_INTERVAL_MS` | `60000` | address-space re-scan interval |
| `PUBLISHING_INTERVAL_MS` | `5000` | subscription publishing interval |
| `SAMPLING_INTERVAL_MS` | `2000` | monitored item sampling interval |
| `SERVER_SAMPLING_INTERVAL_MS` | `5000` | server status variable sampling interval |
| `SUBSCRIPTION_SLACK` | `10` | headroom kept below the server's monitored-item limits |
| `MAX_MONITORED_ITEMS_PER_REQUEST` | `500` | chunk size for `monitorItems` requests |
| `MODEL_CHANGE_RESCAN_DEBOUNCE_MS` | `5000` | debounce for model-change-triggered re-scans |
| `REQUEST_TIMEOUT_MS` | `1800000` | OPC UA request timeout |
| `INIT_RETRY_DELAY_MS` | `10000` | retry delay when initialization fails |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## output.json

The snapshot has three top-level blocks:

```text
{
  "Server":    { Connected, Endpoint, ServerState, ServiceLevel, ServerStatus, NamespaceArray, ServerProfileArray, OperationalLimits },
  "Machinery": { "Machines": [ { NodeId, Attributes, References, Identification, Components, MachineryItemState,
                                 MachineryOperationMode, ProcessValues, ForeignMonitoringTypes, Jobs,
                                 ForeignJobCandidates, BuildingBlocks } ] },
  "Coverage":  { Machines, MachinesFolder, Specs, Features, ForeignTypes }
}
```

Coverage statuses per feature: `found` (at least one spec-matched instance), `foreign-only` (the
feature appears on the server only as a spec-BrowseName-with-foreign-TypeDefinition deviation),
`missing` (no instance found), `client` (a client-side capability, not a server feature).
`Coverage.ForeignTypes` lists every foreign TypeDefinition with its NodeId and namespace URI, so
lookalikes such as MachineTool `MonitoringType [ns=5]` vs the 40001-1 `MonitoringType [ns=3]` are
told apart.

> Note: this is the v2 output shape. The v1 top-level `Machines` list moved to `Machinery.Machines`
> and the per-machine `Monitoring` key was renamed to `ProcessValues`.

## REST API

The application also starts a small HTTP server (read-only — no writes, no method calls).

Default address: `http://localhost:3000` (`PORT`, Docker image: `8080`).

| Endpoint | Returns |
| --- | --- |
| `GET /health` | `ok` / `initializing`, connected flag, server state, service level, machine count |
| `GET /server` | current server information block |
| `GET /coverage` | the full coverage report: "what does this server implement" in one call |
| `GET /machines` | all discovered machines |
| `GET /machines?productInstanceUri=<value>` | machines with a matching `Identification.ProductInstanceUri` |
| `GET /machines/:nodeId` | one machine (NodeId URL-encoded: `/machines/ns%3D50%3Bs%3DMyMachine`) |
| `GET /machines/:nodeId/processvalues` | the machine's OPC 40001-2 ProcessValues |
| `GET /machines/:nodeId/jobs` | the machine's OPC 40001-3 JobManagement results |

Example:

```text
http://localhost:3000/machines?productInstanceUri=https://umati.org/UA/instance/ShowCaseMachineTool-20240301-4711
http://localhost:3000/machines/ns%3D49%3Bs%3DMyControledMachine/jobs
```

The REST API reads directly from the in-memory OPC UA summary, so it does not need to reload
`output.json` for each request.

## Current scope

Implemented (all read-only):

- Machine discovery via the `Machines` folder (OPC 40001-1 §9)
- Machine and component identification / nameplate (§8, §10)
- Components (§11), MachineryItemState (§12), MachineryOperationMode (§13), OperationCounters (§14),
  LifetimeCounters (§15), Monitoring block (§16), MachineryEquipment (§17), Notifications (§18)
- Process values: instances, values, ranges, units, limits, status enums, setpoints, alarms and
  methods discovered and reported (OPC 40001-2)
- Job management: JobManagement AddIn, JobOrderControl / JobOrderResults containers, ISA-95 list
  variables subscribed, method signatures reported (OPC 40001-3 §8, OPC 10031-4)
- Model-change event handling (OPC 10000-3 / -5): re-discovery, removal, monitored-item sync,
  debounced re-scan
- Foreign/vendor type reporting and the per-spec coverage report (`output.json`, `GET /coverage`)

Deliberately not implemented (read-only demo tool):

- Writing values (setpoints, deviations, substitution values, AssetId, ...)
- Calling Methods (ZeroPointAdjustment, Start/Stop/Pause/... job orders, ...)
- Alarm subscription / condition workflows
- Vertical companion specs (MachineTool, PlasticsRubber, LaserSystems, ...) — detected and reported
  as foreign types, not modelled node-by-node
- Security models, certificates, security policies

## Roadmap / feature map

Status legend: [x] done (read-only), [ ] deliberately out of scope for this read-only demo.
Clause numbers reference the current spec documents.

### OPC 40001-1: Machinery Basic Building Blocks

Reference: https://reference.opcfoundation.org/specs/OPC-40001-1/

- [x] §8 Machine identification and nameplate (`MachineryItemIdentificationType`, nameplate interfaces)
- [x] §9 Finding all machines in a server (CU "Machinery Find Machines", `Machines` folder `i=1001`)
- [x] §10 Component identification and nameplate (CU "Machinery Component Identification")
- [x] §11 Finding all components of a machine (CU "Machinery Find Components of Machines")
- [x] §12 MachineryItemState — `CurrentState` read (CU "Machinery MachineryItem State")
- [x] §13 MachineryOperationMode — `CurrentState` read (CU "Machinery Operation Mode")
- [x] §14 Operation counters (CU "Machinery Operation Counter")
- [x] §15 Lifetime counters — discovery and classification (CU "Machinery Lifetime Counter")
- [x] §16 Monitoring building block incl. §16.2 Table 41 subfolder scan (CU "Machinery Monitoring")
- [x] §17 MachineryEquipment (CU "Machinery MachineryEquipment")
- [x] §18 Notifications (CU "Machinery Notifications")
- [x] §7.2 Model-change handling (BaseModelChange / GeneralModelChange / SemanticChange events)
- [ ] Writes and method calls on any block (read-only tool)

### OPC 40001-2: Machinery Process Values

Reference: https://reference.opcfoundation.org/specs/OPC-40001-2/

- [x] §7 ProcessValueType instances: AnalogSignal, SignalTag, EURange / InstrumentRange,
  EngineeringUnits, ValuePrecision, ActualValue, Simulation, limits (LowLow..HighHigh),
  Status / AlarmSuppression with standardized EnumValues, PercentageValue variants
- [x] §7.1 DeviationAlarm / LimitAlarm objects discovered (arguments read, never called, never
  alarmed — alarm state is event-based)
- [x] §8 ZeroPointAdjustment Method and ZeroPointAdjustmentEventType reported, never called
- [x] §9 ProcessValueSetpoint with Table 6 deviation variables, SubstituteValue, DeviationSensitivity
  (CU "Machinery Process Values Base SetpointType")
- [ ] Set / write setpoints, deviations, substitution values (read-only tool)
- [ ] Call ZeroPointAdjustment (read-only tool)
- [ ] Vendor-specific error codes for process value devices

### OPC 40001-3: Machinery Job Management

Reference: https://reference.opcfoundation.org/specs/OPC-40001-3/ (job payload types: OPC 10031-4)

- [x] §8 JobManagement AddIn discovered and modelled (CU "Machinery Job Management Base")
- [x] JobOrderControl / JobOrderResults containers (OPC 10031-4 6.2.1.2 / 6.2.7) with ISA-95 list
  variables subscribed live (`JobOrderList`, `WorkMaster`, material/equipment/personnel IDs)
- [x] Retrieve execution state and results — job states are the `JobOrderList` entries; the
  inherited `CurrentState` is read and its spec deviation (must be Bad per OPC 10031-4) recorded
- [x] Method signatures (`InputArguments` / `OutputArguments`) reported — Start/Stop/Pause/Resume/
  Abort/... , RequestJobResponseBy... 
- [ ] Provide job orders (DownloadJobOrder) — read-only tool
- [ ] Control job orders via Method calls — read-only tool
- [ ] Delete job order results — read-only tool
