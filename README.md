# opcua-machinery-client

### A small Project to showcase the OPC UA for Machinery from the End-User perspective!

The opcua-machinery-client connects to a OPC UA Server reads general Information like ServerState, ServiceLevel,NamespaceArray, ServerProfileArray and OperationalLimit. After that it finds all Machineinstances in the Machinesfolder and discovers basic Attributes about the MachineinstanceObject like DisplayName, BrowseName, Description and explores the MachineIdentification. At the and an output.json will be created with the collected results of the OPC UA Server!

### Roadmap:

:heavy_check_mark: -> Implemented  
:x: -> Not Implemented yet

#### OPC 40001-1: Machinery Basic Building Blocks (https://reference.opcfoundation.org/Machinery/v103/docs/5)
5 Use Cases  
:heavy_check_mark: 5.1 Machine Identification and Nameplate   
:heavy_check_mark: 5.2 Finding all Machines in a Server    
:x: 5.3 Component Identification and Nameplate  
:heavy_check_mark: 5.4 Finding all Components of a Machine    
:x: 5.5 Machine Monitoring  
:x: 5.6 Preventive Maintenance  

#### OPC 40001-2: Machinery Process Values (https://reference.opcfoundation.org/Machinery/ProcessValues/v100/docs/5)
5 Use Cases  
:x: The user would like to access the process values of a machine and its various meta data like ranges, precision and unit.  
:x: The user would like to access and set the setpoints of the process values of a machine.  
:x: The user would like to access and set deviation limits of the process values, relative to the setpoints.  
:x: The user would like to get informed when a process value is passing a deviation limit or range.  
:x: The user would like to get the percentage value of a process variable, also when there are dynamic ranges.  
:x: The user would like to zero-point adjust the current value of a process value.  
:x: The user would like to get vendor-specific error codes on devices providing process values.  
:x: The user would like to access and set a substitution value in case of connections lost.  
:x: The user would like to get identification information of devices providing process values.  
:x: The user would like to get information about the health status of devices providing process values.  
