window.IPAM_DEMO = (() => {
  const now = Date.now();
  const ago = (hours) => new Date(now - hours * 3600000).toISOString();

  const vlans = [
    {id:1,vlan_id:10,name:"HQ-USERS",site:"HQ",department:"Corporate",gateway:"10.20.10.1",subnet_ids:[1]},
    {id:2,vlan_id:20,name:"HQ-VOICE",site:"HQ",department:"Unified Comms",gateway:"10.20.20.1",subnet_ids:[2]},
    {id:3,vlan_id:30,name:"HQ-SERVERS",site:"HQ",department:"IT",gateway:"10.20.30.1",subnet_ids:[3]},
    {id:4,vlan_id:40,name:"HQ-WIFI",site:"HQ",department:"Corporate",gateway:"10.20.40.1",subnet_ids:[4]},
    {id:5,vlan_id:50,name:"HQ-MGMT",site:"HQ",department:"IT",gateway:"10.20.50.1",subnet_ids:[5]},
    {id:6,vlan_id:110,name:"BR-USERS",site:"Branch",department:"Operations",gateway:"10.21.10.1",subnet_ids:[6]},
    {id:7,vlan_id:120,name:"BR-VOICE",site:"Branch",department:"Unified Comms",gateway:"10.21.20.1",subnet_ids:[7]},
    {id:8,vlan_id:210,name:"DC-SERVERS",site:"Datacenter",department:"Infrastructure",gateway:"10.22.10.1",subnet_ids:[8]}
  ];

  const subnets = [
    {id:1,name:"HQ Users",cidr:"10.20.10.0/24",site:"HQ",department:"Corporate",vlan_id:10,gateway:"10.20.10.1",dns1:"10.20.30.10",dns2:"10.20.30.11",used:198,total_hosts:254,updated_at:ago(.5)},
    {id:2,name:"HQ Voice",cidr:"10.20.20.0/25",site:"HQ",department:"Unified Comms",vlan_id:20,gateway:"10.20.20.1",dns1:"10.20.30.10",dns2:"10.20.30.11",used:74,total_hosts:126,updated_at:ago(5)},
    {id:3,name:"HQ Servers",cidr:"10.20.30.0/26",site:"HQ",department:"IT",vlan_id:30,gateway:"10.20.30.1",dns1:"10.20.30.10",dns2:"10.20.30.11",used:49,total_hosts:62,updated_at:ago(1.5)},
    {id:4,name:"HQ Corporate Wi-Fi",cidr:"10.20.40.0/23",site:"HQ",department:"Corporate",vlan_id:40,gateway:"10.20.40.1",dns1:"10.20.30.10",dns2:"10.20.30.11",used:402,total_hosts:510,updated_at:ago(2)},
    {id:5,name:"HQ Infrastructure Mgmt",cidr:"10.20.50.0/27",site:"HQ",department:"IT",vlan_id:50,gateway:"10.20.50.1",dns1:"10.20.30.10",dns2:"10.20.30.11",used:27,total_hosts:30,updated_at:ago(.2)},
    {id:6,name:"Branch Users",cidr:"10.21.10.0/25",site:"Branch",department:"Operations",vlan_id:110,gateway:"10.21.10.1",dns1:"10.20.30.10",dns2:"10.20.30.11",used:62,total_hosts:126,updated_at:ago(8)},
    {id:7,name:"Branch Voice",cidr:"10.21.20.0/27",site:"Branch",department:"Unified Comms",vlan_id:120,gateway:"10.21.20.1",dns1:"10.20.30.10",dns2:"10.20.30.11",used:18,total_hosts:30,updated_at:ago(12)},
    {id:8,name:"Datacenter Servers",cidr:"10.22.10.0/25",site:"Datacenter",department:"Infrastructure",vlan_id:210,gateway:"10.22.10.1",dns1:"10.22.10.10",dns2:"10.22.10.11",used:111,total_hosts:126,updated_at:ago(.7)}
  ];

  const addresses = [
    {id:1,subnet_id:1,subnet:"HQ Users",site:"HQ",ip:"10.20.10.1",state:"Static",hostname:"HQ-GW-V10",mac:"00:1B:54:AA:10:01",owner:"Network Infrastructure",notes:"Default gateway",updated_at:ago(12)},
    {id:2,subnet_id:1,subnet:"HQ Users",site:"HQ",ip:"10.20.10.25",state:"Reserved",hostname:"FIN-PRN-01",mac:"3C:52:82:10:A2:11",owner:"Finance",notes:"Printer reservation",updated_at:ago(9)},
    {id:3,subnet_id:1,subnet:"HQ Users",site:"HQ",ip:"10.20.10.44",state:"DHCP",hostname:"HR-LT-008",mac:"84:7B:EB:9A:11:03",owner:"Nina Cruz",notes:"DHCP lease record",updated_at:ago(.4)},
    {id:4,subnet_id:3,subnet:"HQ Servers",site:"HQ",ip:"10.20.30.10",state:"Static",hostname:"SRV-DNS01",mac:"00:50:56:AA:30:10",owner:"IT",notes:"Primary DNS",updated_at:ago(18)},
    {id:5,subnet_id:3,subnet:"HQ Servers",site:"HQ",ip:"10.20.30.11",state:"Static",hostname:"SRV-DNS02",mac:"00:50:56:AA:30:11",owner:"IT",notes:"Secondary DNS",updated_at:ago(18)},
    {id:6,subnet_id:5,subnet:"HQ Infrastructure Mgmt",site:"HQ",ip:"10.20.50.2",state:"Static",hostname:"CORE-SW-01",mac:"00:1C:73:50:00:02",owner:"Network Infrastructure",notes:"Core switch management",updated_at:ago(.2)},
    {id:7,subnet_id:5,subnet:"HQ Infrastructure Mgmt",site:"HQ",ip:"10.20.50.3",state:"Static",hostname:"CORE-RTR-01",mac:"00:1C:73:50:00:03",owner:"Network Infrastructure",notes:"Core router management",updated_at:ago(.2)},
    {id:8,subnet_id:5,subnet:"HQ Infrastructure Mgmt",site:"HQ",ip:"10.20.50.19",state:"Conflict",hostname:"UNKNOWN",mac:"00:11:22:33:44:55",owner:"Unassigned",notes:"Duplicate record detected against reserved management address",updated_at:ago(.1)},
    {id:9,subnet_id:6,subnet:"Branch Users",site:"Branch",ip:"10.21.10.1",state:"Static",hostname:"BR-GW-V110",mac:"00:1B:54:BB:10:01",owner:"Network Infrastructure",notes:"Default gateway",updated_at:ago(20)},
    {id:10,subnet_id:8,subnet:"Datacenter Servers",site:"Datacenter",ip:"10.22.10.20",state:"Static",hostname:"APP-SRV-01",mac:"00:50:56:22:10:20",owner:"Infrastructure",notes:"Application server",updated_at:ago(2.2)},
    {id:11,subnet_id:8,subnet:"Datacenter Servers",site:"Datacenter",ip:"10.22.10.21",state:"Static",hostname:"DB-SRV-01",mac:"00:50:56:22:10:21",owner:"Infrastructure",notes:"Database server",updated_at:ago(3)}
  ];

  const audit = [
    {id:1,at:ago(.1),actor:"Jim Camus",action:"Conflict flagged",detail:"10.20.50.19 marked Conflict in HQ Infrastructure Mgmt.",subnet_id:5},
    {id:2,at:ago(.2),actor:"Jim Camus",action:"Address updated",detail:"CORE-SW-01 management IP record verified.",subnet_id:5},
    {id:3,at:ago(.5),actor:"IPAM Studio",action:"Utilization recalculated",detail:"HQ Users is now 78% utilized.",subnet_id:1},
    {id:4,at:ago(.7),actor:"Jim Camus",action:"Subnet reviewed",detail:"Datacenter Servers capacity reviewed; 111 of 126 usable addresses allocated.",subnet_id:8},
    {id:5,at:ago(5),actor:"Jim Camus",action:"VLAN documented",detail:"VLAN 20 HQ-VOICE linked to 10.20.20.0/25.",subnet_id:2},
    {id:6,at:ago(12),actor:"IPAM Studio",action:"Address reserved",detail:"10.20.10.25 reserved for FIN-PRN-01.",subnet_id:1}
  ];

  return {generated_at:new Date(now).toISOString(),root_network:"10.20.0.0/16",subnets,addresses,vlans,audit};
})();