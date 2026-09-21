from __future__ import annotations

import ipaddress
import json
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(__file__).resolve().parent / "data"
DB_PATH = DATA_DIR / "ipam.db"
ROOT_NETWORK = "10.0.0.0/8"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def normalize_network(value: str) -> ipaddress.IPv4Network:
    try:
        network = ipaddress.ip_network(value.strip(), strict=False)
    except ValueError as exc:
        raise ValueError("Enter a valid IPv4 CIDR network.") from exc
    if not isinstance(network, ipaddress.IPv4Network):
        raise ValueError("Only IPv4 networks are supported in this project.")
    return network


def normalize_ip(value: str) -> ipaddress.IPv4Address:
    try:
        address = ipaddress.ip_address(value.strip())
    except ValueError as exc:
        raise ValueError("Enter a valid IPv4 address.") from exc
    if not isinstance(address, ipaddress.IPv4Address):
        raise ValueError("Only IPv4 addresses are supported in this project.")
    return address


def usable_hosts(network: ipaddress.IPv4Network) -> int:
    if network.prefixlen >= 31:
        return network.num_addresses
    return max(0, network.num_addresses - 2)


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS vlans(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vlan_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                site TEXT NOT NULL,
                department TEXT NOT NULL DEFAULT '',
                gateway TEXT NOT NULL DEFAULT '',
                UNIQUE(vlan_id, site)
            );

            CREATE TABLE IF NOT EXISTS subnets(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                cidr TEXT NOT NULL UNIQUE,
                site TEXT NOT NULL,
                department TEXT NOT NULL DEFAULT '',
                vlan_id INTEGER,
                gateway TEXT NOT NULL DEFAULT '',
                dns1 TEXT NOT NULL DEFAULT '',
                dns2 TEXT NOT NULL DEFAULT '',
                used INTEGER NOT NULL DEFAULT 0,
                total_hosts INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS addresses(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subnet_id INTEGER NOT NULL,
                ip TEXT NOT NULL UNIQUE,
                state TEXT NOT NULL,
                hostname TEXT NOT NULL DEFAULT '',
                mac TEXT NOT NULL DEFAULT '',
                owner TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                FOREIGN KEY(subnet_id) REFERENCES subnets(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS audit(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at TEXT NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                detail TEXT NOT NULL,
                subnet_id INTEGER,
                FOREIGN KEY(subnet_id) REFERENCES subnets(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_addresses_subnet ON addresses(subnet_id);
            CREATE INDEX IF NOT EXISTS idx_audit_time ON audit(at);
            """
        )
        seed(conn)
        conn.commit()


def seed(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT 1 FROM subnets LIMIT 1").fetchone():
        return

    now = datetime.now(timezone.utc)
    subnet_rows = [
        ("HQ Users","10.20.10.0/24","HQ","Corporate",10,"10.20.10.1","10.20.30.10","10.20.30.11",198),
        ("HQ Voice","10.20.20.0/25","HQ","Unified Comms",20,"10.20.20.1","10.20.30.10","10.20.30.11",74),
        ("HQ Servers","10.20.30.0/26","HQ","IT",30,"10.20.30.1","10.20.30.10","10.20.30.11",49),
        ("HQ Corporate Wi-Fi","10.20.40.0/23","HQ","Corporate",40,"10.20.40.1","10.20.30.10","10.20.30.11",402),
        ("HQ Infrastructure Mgmt","10.20.50.0/27","HQ","IT",50,"10.20.50.1","10.20.30.10","10.20.30.11",27),
        ("Branch Users","10.21.10.0/25","Branch","Operations",110,"10.21.10.1","10.20.30.10","10.20.30.11",62),
        ("Branch Voice","10.21.20.0/27","Branch","Unified Comms",120,"10.21.20.1","10.20.30.10","10.20.30.11",18),
        ("Datacenter Servers","10.22.10.0/25","Datacenter","Infrastructure",210,"10.22.10.1","10.22.10.10","10.22.10.11",111),
    ]
    subnet_ids: dict[str, int] = {}
    for offset, row in enumerate(subnet_rows):
        name,cidr,site,dept,vlan,gateway,dns1,dns2,used = row
        network = normalize_network(cidr)
        cur = conn.execute(
            """
            INSERT INTO subnets(name,cidr,site,department,vlan_id,gateway,dns1,dns2,used,total_hosts,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                name,str(network),site,dept,vlan,gateway,dns1,dns2,used,
                usable_hosts(network),(now-timedelta(hours=offset)).isoformat(),
            ),
        )
        subnet_ids[name] = int(cur.lastrowid)

    vlan_rows = [
        (10,"HQ-USERS","HQ","Corporate","10.20.10.1"),
        (20,"HQ-VOICE","HQ","Unified Comms","10.20.20.1"),
        (30,"HQ-SERVERS","HQ","IT","10.20.30.1"),
        (40,"HQ-WIFI","HQ","Corporate","10.20.40.1"),
        (50,"HQ-MGMT","HQ","IT","10.20.50.1"),
        (110,"BR-USERS","Branch","Operations","10.21.10.1"),
        (120,"BR-VOICE","Branch","Unified Comms","10.21.20.1"),
        (210,"DC-SERVERS","Datacenter","Infrastructure","10.22.10.1"),
    ]
    conn.executemany(
        "INSERT INTO vlans(vlan_id,name,site,department,gateway) VALUES(?,?,?,?,?)",
        vlan_rows,
    )

    address_rows = [
        ("HQ Users","10.20.10.1","Static","HQ-GW-V10","00:1B:54:AA:10:01","Network Infrastructure","Default gateway"),
        ("HQ Users","10.20.10.25","Reserved","FIN-PRN-01","3C:52:82:10:A2:11","Finance","Printer reservation"),
        ("HQ Users","10.20.10.44","DHCP","HR-LT-008","84:7B:EB:9A:11:03","Nico Cruz","DHCP lease record"),
        ("HQ Servers","10.20.30.10","Static","SRV-DNS01","00:50:56:AA:30:10","IT","Primary DNS"),
        ("HQ Servers","10.20.30.11","Static","SRV-DNS02","00:50:56:AA:30:11","IT","Secondary DNS"),
        ("HQ Infrastructure Mgmt","10.20.50.2","Static","CORE-SW-01","00:1C:73:50:00:02","Network Infrastructure","Core switch management"),
        ("HQ Infrastructure Mgmt","10.20.50.3","Static","CORE-RTR-01","00:1C:73:50:00:03","Network Infrastructure","Core router management"),
        ("HQ Infrastructure Mgmt","10.20.50.19","Conflict","UNKNOWN","00:11:22:33:44:55","Unassigned","Duplicate record detected against reserved management address"),
        ("Branch Users","10.21.10.1","Static","BR-GW-V110","00:1B:54:BB:10:01","Network Infrastructure","Default gateway"),
        ("Datacenter Servers","10.22.10.20","Static","APP-SRV-01","00:50:56:22:10:20","Infrastructure","Application server"),
        ("Datacenter Servers","10.22.10.21","Static","DB-SRV-01","00:50:56:22:10:21","Infrastructure","Database server"),
    ]
    for name,ip,state,hostname,mac,owner,notes in address_rows:
        conn.execute(
            """
            INSERT INTO addresses(subnet_id,ip,state,hostname,mac,owner,notes,updated_at)
            VALUES(?,?,?,?,?,?,?,?)
            """,
            (subnet_ids[name],ip,state,hostname,mac,owner,notes,utc_now()),
        )

    conn.executemany(
        "INSERT INTO audit(at,actor,action,detail,subnet_id) VALUES(?,?,?,?,?)",
        [
            (utc_now(),"System","Inventory initialized","Initial subnet, VLAN, and address records created.",None),
            (utc_now(),"IPAM Studio","Conflict flagged","10.20.50.19 marked Conflict in HQ Infrastructure Mgmt.",subnet_ids["HQ Infrastructure Mgmt"]),
        ],
    )


def log_audit(conn: sqlite3.Connection, action: str, detail: str, subnet_id: int | None = None, actor: str = "Jim Camus") -> None:
    conn.execute(
        "INSERT INTO audit(at,actor,action,detail,subnet_id) VALUES(?,?,?,?,?)",
        (utc_now(),actor,action,detail,subnet_id),
    )


def subnet_row(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    return item


def bootstrap() -> dict[str, Any]:
    with db() as conn:
        subnets = [subnet_row(conn,r) for r in conn.execute("SELECT * FROM subnets ORDER BY cidr").fetchall()]
        subnet_lookup = {s["id"]: s for s in subnets}
        addresses = []
        for row in conn.execute("SELECT * FROM addresses ORDER BY ip").fetchall():
            item = dict(row)
            subnet = subnet_lookup.get(item["subnet_id"], {})
            item["subnet"] = subnet.get("name","Unknown")
            item["site"] = subnet.get("site","Unknown")
            addresses.append(item)

        vlans = []
        for row in conn.execute("SELECT * FROM vlans ORDER BY vlan_id").fetchall():
            item = dict(row)
            item["subnet_ids"] = [s["id"] for s in subnets if s["vlan_id"] == item["vlan_id"] and s["site"] == item["site"]]
            vlans.append(item)

        audit = [dict(r) for r in conn.execute("SELECT * FROM audit ORDER BY at DESC,id DESC LIMIT 500").fetchall()]

    return {
        "generated_at": utc_now(),
        "root_network": ROOT_NETWORK,
        "subnets": subnets,
        "addresses": addresses,
        "vlans": vlans,
        "audit": audit,
    }


def assert_no_overlap(conn: sqlite3.Connection, candidate: ipaddress.IPv4Network, ignore_id: int | None = None) -> None:
    rows = conn.execute("SELECT id,cidr,name FROM subnets").fetchall()
    for row in rows:
        if ignore_id is not None and row["id"] == ignore_id:
            continue
        existing = normalize_network(row["cidr"])
        if candidate.overlaps(existing):
            raise ValueError(f"{candidate} overlaps existing subnet {existing} ({row['name']}).")


def validate_gateway_dns(network: ipaddress.IPv4Network, gateway: str, dns1: str, dns2: str) -> None:
    if gateway:
        address = normalize_ip(gateway)
        if address not in network:
            raise ValueError("Gateway must belong to the subnet.")
    for label,value in (("DNS 1",dns1),("DNS 2",dns2)):
        if value:
            normalize_ip(value)


class SubnetCreate(BaseModel):
    name: str = Field(min_length=1,max_length=120)
    cidr: str = Field(min_length=3,max_length=64)
    site: str = Field(min_length=1,max_length=100)
    department: str = Field(default="",max_length=100)
    vlan_id: int | None = Field(default=None,ge=1,le=4094)
    gateway: str = Field(default="",max_length=64)
    dns1: str = Field(default="",max_length=64)
    dns2: str = Field(default="",max_length=64)


class BulkSubnets(BaseModel):
    subnets: list[SubnetCreate] = Field(min_length=1,max_length=64)


class AddressCreate(BaseModel):
    subnet_id: int
    ip: str = Field(min_length=1,max_length=64)
    state: str
    hostname: str = Field(default="",max_length=120)
    mac: str = Field(default="",max_length=64)
    owner: str = Field(default="",max_length=120)
    notes: str = Field(default="",max_length=500)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="IPAM + Subnet Manager API",
    version="1.0.0",
    description="Local IPv4 address management, subnet planning, VLAN documentation, and audit backend.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8810",
        "http://localhost:8810",
        "https://sachibara.github.io",
    ],
    allow_credentials=False,
    allow_methods=["GET","POST","PUT"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
def api_health():
    return {"ok":True,"service":"IPAM + Subnet Manager","database":str(DB_PATH)}


@app.get("/api/bootstrap")
def api_bootstrap():
    return bootstrap()


@app.post("/api/subnets")
def api_create_subnet(request: SubnetCreate):
    try:
        network = normalize_network(request.cidr)
        validate_gateway_dns(network,request.gateway,request.dns1,request.dns2)
    except ValueError as exc:
        raise HTTPException(status_code=400,detail=str(exc)) from exc

    with db() as conn:
        try:
            assert_no_overlap(conn,network)
        except ValueError as exc:
            raise HTTPException(status_code=409,detail=str(exc)) from exc

        cur = conn.execute(
            """
            INSERT INTO subnets(name,cidr,site,department,vlan_id,gateway,dns1,dns2,used,total_hosts,updated_at)
            VALUES(?,?,?,?,?,?,?,?,0,?,?)
            """,
            (
                request.name.strip(),str(network),request.site.strip(),request.department.strip(),
                request.vlan_id,request.gateway.strip(),request.dns1.strip(),request.dns2.strip(),
                usable_hosts(network),utc_now(),
            ),
        )
        subnet_id=int(cur.lastrowid)
        if request.vlan_id is not None:
            vlan=conn.execute("SELECT id FROM vlans WHERE vlan_id=? AND site=?",(request.vlan_id,request.site.strip())).fetchone()
            if not vlan:
                conn.execute(
                    "INSERT INTO vlans(vlan_id,name,site,department,gateway) VALUES(?,?,?,?,?)",
                    (request.vlan_id,f"VLAN-{request.vlan_id}",request.site.strip(),request.department.strip(),request.gateway.strip()),
                )
        log_audit(conn,"Subnet created",f"{network} · {request.name.strip()}",subnet_id)
        conn.commit()
        return dict(conn.execute("SELECT * FROM subnets WHERE id=?",(subnet_id,)).fetchone())


@app.post("/api/subnets/bulk")
def api_create_subnets_bulk(request: BulkSubnets):
    created=[]
    with db() as conn:
        normalized=[]
        for item in request.subnets:
            try:
                network=normalize_network(item.cidr)
                validate_gateway_dns(network,item.gateway,item.dns1,item.dns2)
                assert_no_overlap(conn,network)
            except ValueError as exc:
                raise HTTPException(status_code=409,detail=str(exc)) from exc

            for previous,_ in normalized:
                if network.overlaps(previous):
                    raise HTTPException(status_code=409,detail=f"{network} overlaps another subnet in this request.")
            normalized.append((network,item))

        for network,item in normalized:
            cur=conn.execute(
                """
                INSERT INTO subnets(name,cidr,site,department,vlan_id,gateway,dns1,dns2,used,total_hosts,updated_at)
                VALUES(?,?,?,?,?,?,?,?,0,?,?)
                """,
                (
                    item.name.strip(),str(network),item.site.strip(),item.department.strip(),
                    item.vlan_id,item.gateway.strip(),item.dns1.strip(),item.dns2.strip(),
                    usable_hosts(network),utc_now(),
                ),
            )
            subnet_id=int(cur.lastrowid)
            log_audit(conn,"Subnet created",f"{network} · {item.name.strip()}",subnet_id)
            created.append(subnet_id)
        conn.commit()
    return {"created":len(created),"ids":created}


@app.post("/api/addresses")
def api_create_address(request: AddressCreate):
    allowed_states={"Static","Reserved","DHCP","Available","Conflict"}
    if request.state not in allowed_states:
        raise HTTPException(status_code=400,detail="Invalid address state.")

    with db() as conn:
        subnet=conn.execute("SELECT * FROM subnets WHERE id=?",(request.subnet_id,)).fetchone()
        if not subnet:
            raise HTTPException(status_code=404,detail="Subnet not found.")
        try:
            address=normalize_ip(request.ip)
            network=normalize_network(subnet["cidr"])
        except ValueError as exc:
            raise HTTPException(status_code=400,detail=str(exc)) from exc

        if address not in network:
            raise HTTPException(status_code=400,detail=f"{address} is outside {network}.")
        if network.prefixlen < 31 and address in {network.network_address,network.broadcast_address}:
            raise HTTPException(status_code=400,detail="Network and broadcast addresses cannot be assigned.")
        duplicate=conn.execute("SELECT * FROM addresses WHERE ip=?",(str(address),)).fetchone()
        if duplicate:
            raise HTTPException(status_code=409,detail=f"{address} already exists in IPAM.")

        cur=conn.execute(
            """
            INSERT INTO addresses(subnet_id,ip,state,hostname,mac,owner,notes,updated_at)
            VALUES(?,?,?,?,?,?,?,?)
            """,
            (
                request.subnet_id,str(address),request.state,request.hostname.strip(),
                request.mac.strip(),request.owner.strip(),request.notes.strip(),utc_now(),
            ),
        )
        if request.state!="Available":
            conn.execute(
                "UPDATE subnets SET used=MIN(total_hosts,used+1),updated_at=? WHERE id=?",
                (utc_now(),request.subnet_id),
            )
        log_audit(conn,"Address reserved",f"{address} reserved as {request.state} in {subnet['name']}.",request.subnet_id)
        conn.commit()
        row=dict(conn.execute("SELECT * FROM addresses WHERE id=?",(int(cur.lastrowid),)).fetchone())
        row["subnet"]=subnet["name"];row["site"]=subnet["site"]
        return row


@app.get("/")
def ui():
    return FileResponse(ROOT/"index.html")


@app.get("/styles.css")
def styles():
    return FileResponse(ROOT/"styles.css",media_type="text/css")


@app.get("/demo-data.js")
def demo_data():
    return FileResponse(ROOT/"demo-data.js",media_type="application/javascript")


@app.get("/app.js")
def script():
    return FileResponse(ROOT/"app.js",media_type="application/javascript")


def main() -> None:
    import uvicorn
    print("IPAM + Subnet Manager: http://127.0.0.1:8810")
    uvicorn.run(app,host="127.0.0.1",port=8810,log_level="info")


if __name__=="__main__":
    main()
