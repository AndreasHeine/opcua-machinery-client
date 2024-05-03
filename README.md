# opcua-machinery-client

### A small Project to showcase the OPC UA for Machinery from the End-User perspective!

#### Functionalities
* The Client connects to a OPC UA Server reads general Information like ServerState, ServiceLevel, NamespaceArray, ServerprofileArray, ServerStatus and OperationalLimits. After that it finds all Machineinstances in the Machines-Folder and discovers basic Attributes about the MachineinstanceObject like DisplayName, BrowseName, Description and explores the MachineIdentification as well as the machines Components and their ComponentIdentification. At the end an output.json will be created with the collected results of the OPC UA Server!

* The Client is aware of modelchanges due to "GeneralModelChangeEvents" and partially reinitializes the related Item (Machine-, MachineComponent- or ProcessValue-Instance)!

* The Client automatically subscribes all variables / properties he finds and updates the output.json file every 10s with the latest data

### Roadmap [done: :heavy_check_mark:, not yet: :x:]:

#### OPC 40001-1: Machinery Basic Building Blocks (https://reference.opcfoundation.org/Machinery/v103/docs/5)
5 Use Cases  
:heavy_check_mark: 5.1 Machine Identification and Nameplate   
:heavy_check_mark: 5.2 Finding all Machines in a Server    
:heavy_check_mark: 5.3 Component Identification and Nameplate  
:heavy_check_mark: 5.4 Finding all Components of a Machine    
:heavy_check_mark: 5.5 Machine Monitoring  
:x: 5.6 Preventive Maintenance  

#### OPC 40001-2: Machinery Process Values (https://reference.opcfoundation.org/Machinery/ProcessValues/v100/docs/5)
5 Use Cases  
:heavy_check_mark: The user would like to access the process values of a machine and its various meta data like ranges, precision and unit.  
:x: The user would like to access and set the setpoints of the process values of a machine.  
:x: The user would like to access and set deviation limits of the process values, relative to the setpoints.  
:x: The user would like to get informed when a process value is passing a deviation limit or range.  
:x: The user would like to get the percentage value of a process variable, also when there are dynamic ranges.  
:x: The user would like to zero-point adjust the current value of a process value.  
:x: The user would like to get vendor-specific error codes on devices providing process values.  
:x: The user would like to access and set a substitution value in case of connections lost.  
:x: The user would like to get identification information of devices providing process values.  
:x: The user would like to get information about the health status of devices providing process values.  
