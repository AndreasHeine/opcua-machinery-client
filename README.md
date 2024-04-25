# opcua-machinery-client

### A small Project to showcase the OPC UA for Machinery from the End-User perspective!

### Example:
```js
ServerSummery = {
  Server: {
    Endpoint: 'opc.tcp://127.0.0.1:4840',
    ServerState: 0,
    ServiceLevel: 255,
    NamespaceArray: [
      'http://opcfoundation.org/UA/',
      'urn:konzeptpark-opcua-server',
      'http://opcfoundation.org/UA/DI/',
      'http://opcfoundation.org/UA/IA/',
      'http://opcfoundation.org/UA/Machinery/',
      'http://opcfoundation.org/UA/Dictionary/IRDI',       
      'http://opcfoundation.org/UA/PADIM/',
      'http://opcfoundation.org/UA/Machinery/ProcessValues/',
      'http://mynewmachinenamespace/UA'
    ],
    OperationalLimits: {
      MaxSubscriptionsPerSession: 10,
      MaxMonitoredItemsPerSubscription: 100000,
      MaxMonitoredItemsPerCall: 1000,
      MaxNodesPerMethodCall: 0,
      MaxNodesPerRead: 1000,
      MaxNodesPerTranslateBrowsePathsToNodeIds: 1000,
      MaxNodesPerWrite: 1000
    }
  },
  Machines: {
    MyMachine: {
      NodeId: 'ns=8;s=MyMachine',
      BrowseName: [Object],
      DisplayName: [Object],
      Description: {}
    }
  }
}
```

### Todo:
- Add Identification to Summery
- Add BasicBuildingBlocks to Summery
- Add Monitoring of ProcessValues to Summery
- Update Summery on ProcessValue change