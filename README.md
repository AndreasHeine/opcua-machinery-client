# opcua-machinery-client

A simple OPC UA Machinery client focused on end users.

## What this program does

This client connects to an OPC UA server and automatically discovers machines that follow the OPC UA Machinery model.

It then collects useful information, such as:

- Server health and capability information
- List of available machines
- Machine identification details
- Machine components and component identification
- Monitoring values (process values)
- Machine state and operation mode (if available)

All collected data is written to `output.json` and refreshed every 10 seconds.

## Why this is useful for end users

This project is useful when you want a clear, ready-to-use view of machine data without manually browsing an OPC UA address space.

Main benefits:

- Quick onboarding: see machine data in one JSON file
- Easy integration: `output.json` can be consumed by scripts, dashboards, or data pipelines
- Live updates: values are subscribed and updated continuously
- Better reliability: reconnect and model-change handling are built in

In short, it turns a complex OPC UA server structure into a simple, machine-readable snapshot for operations, diagnostics, and integration work.

## How it works (in plain language)

1. Connects to the OPC UA endpoint.
2. Reads server status and limits.
3. Finds machine instances in the Machinery folder.
4. Discovers metadata, components, and monitoring values.
5. Subscribes to value changes.
6. Writes and refreshes `output.json` every 10 seconds.

## Quick start

### Requirements

- Node.js 18+
- npm

### Install and run

```bash
npm install
npm start
```

After startup, check `output.json` in the project root.

## Configuration

The server endpoint is configured in `src/main.ts`.

Current default endpoint:

- `opc.tcp://opcua.umati.app:4843`

You can replace it with your own OPC UA server endpoint.

## Current scope

Implemented:

- Machine discovery
- Machine and component identification
- Process value monitoring (read)
- Automatic JSON export
- Partial handling of model changes

Not implemented yet:

- Writing setpoints
- Deviation/alarm workflows
- Job management features

## Roadmap

Status legend: [x] done, [ ] not yet

### OPC 40001-1: Machinery Basic Building Blocks

Reference: https://reference.opcfoundation.org/Machinery/v103/docs/5

- [x] 5.1 Machine Identification and Nameplate
- [x] 5.2 Finding all Machines in a Server
- [x] 5.3 Component Identification and Nameplate
- [x] 5.4 Finding all Components of a Machine
- [x] 5.5 Machine Monitoring
- [ ] 5.6 Preventive Maintenance

### OPC 40001-2: Machinery Process Values

Reference: https://reference.opcfoundation.org/Machinery/ProcessValues/v100/docs/5

- [x] Access process values and selected metadata
- [ ] Access and set process value setpoints
- [ ] Access and set deviation limits relative to setpoints
- [ ] Notify when process value exceeds deviation limit or range
- [ ] Access percentage value with dynamic ranges
- [ ] Zero-point adjustment of process values
- [ ] Vendor-specific error codes for process value devices
- [ ] Access and set substitution value for connection loss
- [ ] Identification information of process value devices
- [ ] Health status information of process value devices

### OPC 40001-3: Machinery Job Management

Reference: https://reference.opcfoundation.org/Machinery/Jobs/v100/docs/

- [ ] Provide job orders to a MachineryItem
- [ ] Control job orders (update, start, revoke, pause, resume, abort, stop)
- [ ] Retrieve execution state, intermediate results, and final result
- [ ] Delete job order results after execution
