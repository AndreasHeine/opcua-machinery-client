# opcua-machinery-client

### A small Project to showcase the OPC UA for Machinery from the End-User perspective!

The opcua-machinery-client connects to a OPC UA Server reads general Information like ServerState, ServiceLevel,NamespaceArray, ServerProfileArray and OperationalLimit. After that it finds all Machineinstances in the Machinesfolder and discovers basic Attributes about the MachineinstanceObject like DisplayName, BrowseName, Description and explores the MachineIdentification. At the and an output.json will be created with the collected results of the OPC UA Server!

### Todo:
- Add BasicBuildingBlocks to Summery
- Add Monitoring of ProcessValues to Summery
- Update Summery on ProcessValue change