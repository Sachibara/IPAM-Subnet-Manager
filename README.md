# IPAM + Subnet Manager

A portfolio-grade IP Address Management and subnet-planning platform for Network Engineering, NOC, IT Infrastructure, and Network Operations roles.


## Public App

**Live app:** https://sachibara.github.io/IPAM-Subnet-Manager/

## Architecture

- **Browser Workspace Mode** — public browser application with realistic sites, VLANs, subnets, address utilization, reservations, and audit activity.
- **Live Backend Mode** — local FastAPI + SQLite backend with persistent subnet, VLAN, address, and audit records.

## Core Features

- IPv4 address inventory
- CIDR / subnet calculator
- VLAN documentation
- Subnet allocation and utilization
- Reserved, Static, DHCP, Available, and Conflict address states
- Gateway and DNS documentation
- Site / department tagging
- Subnet overlap and IP conflict detection
- Address search and filtering
- Available-address discovery
- Subnet splitting
- CSV export
- Audit history
- REST API
- SQLite persistence
- Responsive blueprint-style UI

## Run Live Mode

```powershell
python -m pip install -r backend/requirements.txt
python backend/ipam_api.py
```

Then open:

```text
http://127.0.0.1:8810
```

## Safety / Scope

The live backend manages only records entered into its local IPAM database. It does not scan, probe, or alter network devices automatically.

## Developer

**Jim Rodmark Camus**  
BSIT — Network Technology  
GitHub: [@Sachibara](https://github.com/Sachibara)
