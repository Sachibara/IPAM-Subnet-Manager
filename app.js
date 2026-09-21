(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const qsa = (selector, root=document) => [...root.querySelectorAll(selector)];

  const pageMeta = {
    overview:["Address-space overview","Network Address Plan"],
    subnets:["Address allocation","Subnet Map"],
    addresses:["IP inventory","Address Records"],
    vlans:["Layer 2 documentation","VLAN Registry"],
    planner:["CIDR engineering","Subnet Planner"],
    audit:["Traceability","Audit History"],
    about:["Project architecture","About IPAM Studio"]
  };

  const state = {
    mode: localStorage.getItem("ipam_mode") || (location.port === "8810" ? "live" : "demo"),
    backendUrl: localStorage.getItem("ipam_backend_url") || (location.port === "8810" ? location.origin : "http://127.0.0.1:8810"),
    data: null,
    activePage: "overview",
    selectedSubnet: null,
    planner: null,
    lastRefresh: null
  };

  function esc(v){
    return String(v ?? "")
      .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
      .replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  function fmtTime(iso){
    if(!iso) return "—";
    const d = new Date(iso), diff = Math.max(0, Date.now() - d.getTime());
    if(diff < 60000) return "just now";
    if(diff < 3600000) return Math.round(diff/60000)+"m ago";
    if(diff < 86400000) return Math.round(diff/3600000)+"h ago";
    return Math.round(diff/86400000)+"d ago";
  }

  function toast(title, message="", type="info"){
    const node = document.createElement("div");
    node.className = "toast "+type;
    node.innerHTML = "<strong>"+esc(title)+"</strong><span>"+esc(message)+"</span>";
    $("toastRegion").appendChild(node);
    setTimeout(()=>node.remove(), 4300);
  }

  function ipToInt(ip){
    const parts = String(ip).trim().split(".").map(Number);
    if(parts.length !== 4 || parts.some(n=>!Number.isInteger(n)||n<0||n>255)) throw new Error("Invalid IPv4 address");
    return (((parts[0]*256 + parts[1])*256 + parts[2])*256 + parts[3]) >>> 0;
  }

  function intToIp(n){
    n = Number(n) >>> 0;
    return [n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join(".");
  }

  function cidrInfo(input){
    const raw = String(input).trim();
    if(!raw.includes("/")) throw new Error("CIDR prefix is required.");
    const [ip,prefixRaw] = raw.split("/");
    const prefix = Number(prefixRaw);
    if(!Number.isInteger(prefix)||prefix<0||prefix>32) throw new Error("Prefix must be between /0 and /32.");
    const ipInt = ipToInt(ip);
    const mask = prefix===0 ? 0 : (0xffffffff << (32-prefix)) >>> 0;
    const network = (ipInt & mask) >>> 0;
    const block = 2 ** (32-prefix);
    const broadcast = (network + block - 1) >>> 0;
    const usable = prefix>=31 ? block : Math.max(0,block-2);
    const first = prefix===32 ? network : prefix===31 ? network : network+1;
    const last = prefix===32 ? network : prefix===31 ? broadcast : broadcast-1;
    return {
      input:raw, prefix, mask:intToIp(mask), network:intToIp(network),
      broadcast:intToIp(broadcast), first:intToIp(first), last:intToIp(last),
      total:block, usable, cidr:intToIp(network)+"/"+prefix, networkInt:network, broadcastInt:broadcast
    };
  }

  function ipInCidr(ip,cidr){
    const info=cidrInfo(cidr), n=ipToInt(ip);
    return n>=info.networkInt && n<=info.broadcastInt;
  }

  function splitCidr(cidr,newPrefix){
    const info=cidrInfo(cidr);
    const p=Number(newPrefix);
    if(!Number.isInteger(p)||p<info.prefix||p>32) throw new Error("Split prefix must be between /"+info.prefix+" and /32.");
    const childSize=2**(32-p), count=2**(p-info.prefix), result=[];
    for(let i=0;i<count;i++){
      const n=(info.networkInt + i*childSize) >>> 0;
      const child=cidrInfo(intToIp(n)+"/"+p);
      result.push(child);
      if(result.length>=256) break;
    }
    return {parent:info, children:result, totalChildren:count};
  }

  function cloneDemo(){
    const saved=sessionStorage.getItem("ipam_demo_state");
    if(saved){try{return JSON.parse(saved)}catch{}}
    return JSON.parse(JSON.stringify(window.IPAM_DEMO));
  }

  function persistDemo(){
    if(state.mode==="demo") sessionStorage.setItem("ipam_demo_state", JSON.stringify(state.data));
  }

  async function fetchJson(path,options={}){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(), options.timeout || 10000);
    try{
      const response=await fetch(state.backendUrl.replace(/\/$/,"")+path,{
        ...options, signal:controller.signal,
        headers:{"Content-Type":"application/json",...(options.headers||{})}
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(data.detail||data.error||"Request failed ("+response.status+")");
      return data;
    }finally{clearTimeout(timer)}
  }

  function setMode(kind,title,detail){
    $("modeDot").className="mode-dot"+(kind?" "+kind:"");
    $("modeTitle").textContent=title;
    $("modeDetail").textContent=detail;
  }

  async function loadData(showToast=false){
    if(state.mode==="demo"){
      state.data=cloneDemo(); state.lastRefresh=new Date();
      setMode("","Demo plan","Representative IPAM data");
      renderAll();
      if(showToast) toast("IPAM refreshed","Demo address plan reloaded.");
      return;
    }
    setMode("","Connecting…",state.backendUrl);
    try{
      state.data=await fetchJson("/api/bootstrap");
      state.lastRefresh=new Date();
      setMode("live","Live IPAM",state.backendUrl.replace(/^https?:\/\//,""));
      renderAll();
      if(showToast) toast("IPAM refreshed","Persistent address records loaded.");
    }catch(e){
      setMode("error","Backend unavailable",state.backendUrl.replace(/^https?:\/\//,""));
      toast("Could not reach IPAM backend",e.message,"error");
      if(!state.data){state.data=cloneDemo();renderAll()}
    }
  }

  function subnetUtil(s){
    const total=Math.max(1,Number(s.total_hosts)||cidrInfo(s.cidr).usable||1);
    return Math.min(100,Math.round((Number(s.used)||0)/total*100));
  }

  function utilClass(s){
    const u=subnetUtil(s);
    return u>=90?"full":u>=75?"high":"healthy";
  }

  function derived(){
    const subnets=state.data?.subnets||[], addresses=state.data?.addresses||[], vlans=state.data?.vlans||[];
    const conflicts=addresses.filter(a=>a.state==="Conflict");
    const used=subnets.reduce((sum,s)=>sum+(Number(s.used)||0),0);
    const capacity=subnets.reduce((sum,s)=>sum+(Number(s.total_hosts)||0),0);
    return {subnets,addresses,vlans,conflicts,used,capacity,util:capacity?used/capacity*100:0};
  }

  function openPage(page){
    state.activePage=page;
    qsa("[data-page-panel]").forEach(p=>p.classList.toggle("active",p.dataset.pagePanel===page));
    qsa("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    $("pageEyebrow").textContent=pageMeta[page][0];
    $("pageTitle").textContent=pageMeta[page][1];
    if(page==="subnets") renderSubnets();
    if(page==="addresses") renderAddresses();
    if(page==="vlans") renderVlans();
    if(page==="planner") renderPlanner();
    if(page==="audit") renderAudit();
  }

  qsa("[data-page]").forEach(b=>b.addEventListener("click",()=>openPage(b.dataset.page)));
  qsa("[data-go]").forEach(b=>b.addEventListener("click",()=>openPage(b.dataset.go)));

  function renderOverview(){
    const d=derived();
    $("heroNetwork").textContent=state.data?.root_network||"10.0.0.0/8";
    $("heroUsed").textContent=d.used.toLocaleString();
    $("heroAvailable").textContent=Math.max(0,d.capacity-d.used).toLocaleString();
    $("heroUtil").textContent=d.util.toFixed(1)+"%";
    $("statSubnets").textContent=d.subnets.length;
    $("statAddresses").textContent=d.addresses.length;
    $("statUtil").textContent=d.util.toFixed(1)+"%";
    $("statConflicts").textContent=d.conflicts.length;
    $("statVlans").textContent=d.vlans.length;

    $("subnetMap").innerHTML=d.subnets.slice(0,12).map(s=>{
      const u=subnetUtil(s), cls=utilClass(s);
      return '<div class="map-cell '+cls+'" style="--util:'+u+'%" data-subnet="'+s.id+'"><strong>'+esc(s.cidr)+'</strong><span>'+esc(s.name)+'</span><small>'+u+'% · VLAN '+esc(s.vlan_id||"—")+'</small></div>';
    }).join("");

    const alerts=[
      ...d.conflicts.map(a=>({red:true,title:"Conflict · "+a.ip,detail:a.subnet+" · "+(a.notes||"Review address record"),label:"Conflict"})),
      ...d.subnets.filter(s=>utilClass(s)==="full").map(s=>({red:false,title:s.name,detail:s.cidr+" · "+subnetUtil(s)+"% utilized",label:"Capacity"}))
    ].slice(0,7);
    $("alertList").innerHTML=alerts.length?alerts.map(a=>'<div class="alert-item"><i class="'+(a.red?"red":"")+'"></i><div><strong>'+esc(a.title)+'</strong><small>'+esc(a.detail)+'</small></div><b>'+esc(a.label)+'</b></div>').join(""):'<div class="empty">No conflicts or capacity alerts.</div>';

    const siteStats={};
    d.subnets.forEach(s=>{siteStats[s.site]=(siteStats[s.site]||0)+(Number(s.total_hosts)||0)});
    const entries=Object.entries(siteStats).sort((a,b)=>b[1]-a[1]), max=Math.max(1,...entries.map(e=>e[1]));
    $("siteBars").innerHTML=entries.map(([site,total])=>'<div class="bar-row"><span>'+esc(site)+'</span><div class="bar-track"><div class="bar-fill" style="width:'+total/max*100+'%"></div></div><strong>'+total+'</strong></div>').join("");

    $("recentActivity").innerHTML=(state.data?.audit||[]).slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,6).map(a=>'<div class="activity-item"><span class="vlan-id">LOG</span><div><strong>'+esc(a.action)+'</strong><small>'+esc(a.actor+" · "+a.detail)+'</small></div><time>'+fmtTime(a.at)+'</time></div>').join("");

    qsa("[data-subnet]",$("subnetMap")).forEach(n=>n.addEventListener("click",()=>openSubnet(Number(n.dataset.subnet))));
  }

  function refreshSubnetFilters(){
    const sites=[...new Set((state.data?.subnets||[]).map(s=>s.site))].sort();
    const sel=$("subnetSiteFilter"),current=sel.value;
    sel.innerHTML='<option value="all">All sites</option>'+sites.map(x=>'<option>'+esc(x)+'</option>').join("");
    if(sites.includes(current)) sel.value=current;
  }

  function renderSubnets(){
    refreshSubnetFilters();
    const q=$("subnetSearch").value.trim().toLowerCase(), site=$("subnetSiteFilter").value, stateFilter=$("subnetStateFilter").value;
    const list=(state.data?.subnets||[]).filter(s=>{
      const hay=[s.name,s.cidr,s.site,s.department,s.vlan_id,s.gateway,s.dns1,s.dns2].join(" ").toLowerCase();
      return (!q||hay.includes(q))&&(site==="all"||s.site===site)&&(stateFilter==="all"||utilClass(s)===stateFilter);
    }).sort((a,b)=>a.cidr.localeCompare(b.cidr,undefined,{numeric:true}));

    $("subnetBoard").innerHTML=list.length?list.map(s=>{
      const u=subnetUtil(s), cls=utilClass(s);
      return '<article class="subnet-card" data-id="'+s.id+'"><div class="subnet-card-top"><div><span class="cidr">'+esc(s.cidr)+'</span><h3>'+esc(s.name)+'</h3></div><span class="util-badge '+cls+'">'+u+'%</span></div><p>'+esc(s.site+" · "+(s.department||"Unassigned"))+'</p><div class="util-track"><span class="'+cls+'" style="width:'+u+'%"></span></div><div class="subnet-meta"><span>VLAN '+esc(s.vlan_id||"—")+'</span><span>GW '+esc(s.gateway||"—")+'</span><span>'+s.used+' / '+s.total_hosts+' used</span><span>'+Math.max(0,s.total_hosts-s.used)+' free</span></div></article>';
    }).join(""):'<div class="empty">No subnets match the current filters.</div>';

    qsa("[data-id]",$("subnetBoard")).forEach(card=>card.addEventListener("click",()=>openSubnet(Number(card.dataset.id))));
  }

  function renderAddresses(){
    const subnetSel=$("addressSubnetFilter"),current=subnetSel.value;
    subnetSel.innerHTML='<option value="all">All subnets</option>'+(state.data?.subnets||[]).map(s=>'<option value="'+s.id+'">'+esc(s.name+" · "+s.cidr)+'</option>').join("");
    if([...subnetSel.options].some(o=>o.value===current)) subnetSel.value=current;

    const q=$("addressSearch").value.trim().toLowerCase(), st=$("addressStateFilter").value, sn=subnetSel.value;
    const rows=(state.data?.addresses||[]).filter(a=>{
      const hay=[a.ip,a.hostname,a.mac,a.owner,a.subnet,a.site,a.notes].join(" ").toLowerCase();
      return (!q||hay.includes(q))&&(st==="all"||a.state===st)&&(sn==="all"||String(a.subnet_id)===sn);
    }).sort((a,b)=>ipToInt(a.ip)-ipToInt(b.ip));

    $("addressTableBody").innerHTML=rows.length?rows.map(a=>'<tr><td><span class="ip-code">'+esc(a.ip)+'</span></td><td><span class="state-chip '+a.state.toLowerCase()+'">'+esc(a.state)+'</span></td><td>'+esc(a.hostname||"—")+'</td><td>'+esc(a.mac||"—")+'</td><td>'+esc(a.owner||"—")+'</td><td>'+esc(a.subnet)+'</td><td>'+esc(a.site)+'</td><td>'+fmtTime(a.updated_at)+'</td></tr>').join(""):'<tr><td colspan="8" class="empty">No IP records match the filters.</td></tr>';
  }

  function renderVlans(){
    $("vlanGrid").innerHTML=(state.data?.vlans||[]).sort((a,b)=>a.vlan_id-b.vlan_id).map(v=>{
      const subnets=(state.data.subnets||[]).filter(s=>s.vlan_id===v.vlan_id);
      return '<article class="vlan-card"><span class="vlan-id">VLAN '+v.vlan_id+'</span><h3>'+esc(v.name)+'</h3><p>'+esc(v.site+" · "+v.department)+'</p><div class="vlan-links">'+subnets.map(s=>'<span>'+esc(s.cidr+" · GW "+s.gateway)+'</span>').join("")+'</div></article>';
    }).join("");
  }

  function renderAudit(){
    $("auditList").innerHTML=(state.data?.audit||[]).slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).map(a=>'<div class="activity-item"><span class="vlan-id">LOG</span><div><strong>'+esc(a.action)+'</strong><small>'+esc(a.actor+" · "+a.detail)+'</small></div><time>'+fmtTime(a.at)+'</time></div>').join("");
  }

  function renderPlanner(){
    if(!state.planner) calculatePlanner();
    renderAvailableFromPlanner();
  }

  function calculatePlanner(){
    try{
      const info=cidrInfo($("plannerNetwork").value);
      const split=splitCidr(info.cidr,Number($("plannerPrefix").value));
      state.planner={...split,selected:new Set()};
      $("calcGrid").innerHTML=[
        ["Network",info.network],["Mask",info.mask],["Broadcast",info.broadcast],["Usable hosts",info.usable],
        ["First host",info.first],["Last host",info.last],["Prefix","/"+info.prefix],["Child subnets",split.totalChildren]
      ].map(([k,v])=>'<div class="calc-tile"><span>'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>').join("");

      $("splitList").innerHTML=split.children.map((child,i)=>{
        const overlaps=(state.data?.subnets||[]).some(s=>{
          const x=cidrInfo(s.cidr);
          return !(child.broadcastInt < x.networkInt || child.networkInt > x.broadcastInt);
        });
        return '<label class="split-item"><input type="checkbox" data-child="'+i+'" '+(overlaps?"disabled":"")+'><div><strong>'+esc(child.cidr)+'</strong><small>'+child.usable+' usable hosts</small></div><span>'+(overlaps?"Overlaps":"Available")+'</span></label>';
      }).join("");
      qsa("[data-child]",$("splitList")).forEach(cb=>cb.addEventListener("change",()=>{
        const i=Number(cb.dataset.child);
        if(cb.checked) state.planner.selected.add(i); else state.planner.selected.delete(i);
      }));
      renderAvailableFromPlanner();
    }catch(e){
      $("calcGrid").innerHTML='<div class="empty">'+esc(e.message)+'</div>';
      $("splitList").innerHTML='<div class="empty">Enter a valid IPv4 CIDR block.</div>';
      $("availableList").innerHTML="";
      state.planner=null;
    }
  }

  function renderAvailableFromPlanner(){
    if(!state.planner){$("availableList").innerHTML='<div class="empty">Calculate a subnet first.</div>';return}
    const first=state.planner.parent.first,last=state.planner.parent.last;
    const used=new Set((state.data?.addresses||[]).map(a=>a.ip));
    let n=ipToInt(first),end=ipToInt(last),items=[];
    while(n<=end && items.length<10){
      const ip=intToIp(n);
      if(!used.has(ip)) items.push(ip);
      n++;
    }
    $("availableList").innerHTML=items.length?items.map(ip=>'<div class="available-item"><span class="vlan-id">FREE</span><div><strong>'+esc(ip)+'</strong><small>Available within '+esc(state.planner.parent.cidr)+'</small></div><code>'+esc(state.planner.parent.cidr)+'</code></div>').join(""):'<div class="empty">No unmanaged addresses found in this range.</div>';
  }

  async function commitSelectedChildren(){
    if(!state.planner||!state.planner.selected.size){toast("Select child subnets","Choose one or more available child networks.","error");return}
    const selected=[...state.planner.selected].map(i=>state.planner.children[i]);
    if(state.mode==="live"){
      try{
        const result=await fetchJson("/api/subnets/bulk",{method:"POST",body:JSON.stringify({
          subnets:selected.map((c,i)=>({name:"Planned subnet "+(i+1),cidr:c.cidr,site:"Planned",department:"",vlan_id:null,gateway:"",dns1:"",dns2:""}))
        })});
        await loadData();toast("Subnets created",result.created+" subnet(s) added.");openPage("subnets");
      }catch(e){toast("Could not create subnets",e.message,"error")}
      return;
    }
    for(const child of selected){
      const id=Math.max(0,...state.data.subnets.map(s=>s.id))+1;
      state.data.subnets.push({id,name:"Planned subnet",cidr:child.cidr,site:"Planned",department:"",vlan_id:null,gateway:"",dns1:"",dns2:"",used:0,total_hosts:child.usable,updated_at:new Date().toISOString()});
      addAudit("Jim Camus","Subnet created",child.cidr+" created from planner.",id);
    }
    persistDemo();renderAll();toast("Subnets created",selected.length+" demo subnet(s) added.");openPage("subnets");
  }

  function addAudit(actor,action,detail,subnetId=null){
    const next=Math.max(0,...(state.data.audit||[]).map(a=>a.id))+1;
    state.data.audit.unshift({id:next,at:new Date().toISOString(),actor,action,detail,subnet_id:subnetId});
  }

  async function openSubnet(id){
    const s=(state.data?.subnets||[]).find(x=>x.id===id); if(!s)return;
    state.selectedSubnet=id;
    const info=cidrInfo(s.cidr),u=subnetUtil(s);
    $("detailSubnetTitle").textContent=s.name;
    $("detailCidr").textContent=s.cidr;
    $("detailStats").innerHTML=[
      ["Network",info.network],["Broadcast",info.broadcast],["Usable",info.usable],["Used",s.used],["Free",Math.max(0,s.total_hosts-s.used)],["Utilization",u+"%"]
    ].map(([k,v])=>'<div class="detail-stat"><span>'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>').join("");
    $("detailMeta").innerHTML=[
      ["Site",s.site],["Department",s.department||"—"],["VLAN",s.vlan_id||"—"],["Gateway",s.gateway||"—"],["DNS 1",s.dns1||"—"],["DNS 2",s.dns2||"—"]
    ].map(([k,v])=>'<div class="meta-box"><span>'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>').join("");
    const addresses=(state.data.addresses||[]).filter(a=>a.subnet_id===id).slice(0,16);
    $("detailAddresses").innerHTML=addresses.length?addresses.map(a=>'<div class="mini-address"><strong>'+esc(a.ip)+'</strong><small>'+esc(a.state+" · "+(a.hostname||"—"))+'</small></div>').join(""):'<div class="empty">No managed IP records in this subnet.</div>';
    $("subnetDetailDialog").showModal();
  }

  function openPlannerForSubnet(){
    const s=(state.data?.subnets||[]).find(x=>x.id===state.selectedSubnet);if(!s)return;
    $("subnetDetailDialog").close();openPage("planner");
    const info=cidrInfo(s.cidr);$("plannerNetwork").value=s.cidr;$("plannerPrefix").value=Math.min(32,info.prefix+1);calculatePlanner();
  }

  $("splitSubnetButton").addEventListener("click",openPlannerForSubnet);

  $("addSubnetButton").addEventListener("click",()=>{$("subnetForm").reset();$("subnetDialog").showModal()});
  $("subnetForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const body={
      name:$("subnetName").value.trim(),cidr:$("subnetCidr").value.trim(),site:$("subnetSite").value.trim(),
      department:$("subnetDepartment").value.trim(),vlan_id:$("subnetVlan").value?Number($("subnetVlan").value):null,
      gateway:$("subnetGateway").value.trim(),dns1:$("subnetDns1").value.trim(),dns2:$("subnetDns2").value.trim()
    };
    try{body.cidr=cidrInfo(body.cidr).cidr}catch(err){toast("Invalid subnet",err.message,"error");return}
    if(state.mode==="live"){
      try{const result=await fetchJson("/api/subnets",{method:"POST",body:JSON.stringify(body)});$("subnetDialog").close();await loadData();toast("Subnet created",result.cidr)}
      catch(err){toast("Could not create subnet",err.message,"error")}
      return;
    }
    const overlap=state.data.subnets.find(s=>{const a=cidrInfo(s.cidr),b=cidrInfo(body.cidr);return !(b.broadcastInt<a.networkInt||b.networkInt>a.broadcastInt)});
    if(overlap){toast("Subnet overlap",body.cidr+" overlaps "+overlap.cidr,"error");return}
    const id=Math.max(0,...state.data.subnets.map(s=>s.id))+1,info=cidrInfo(body.cidr);
    state.data.subnets.push({id,...body,used:0,total_hosts:info.usable,updated_at:new Date().toISOString()});
    addAudit("Jim Camus","Subnet created",body.cidr+" · "+body.name,id);persistDemo();$("subnetDialog").close();renderAll();toast("Subnet created",body.cidr);
  });

  function populateAddressSubnet(){
    $("addressSubnet").innerHTML=(state.data?.subnets||[]).map(s=>'<option value="'+s.id+'">'+esc(s.name+" · "+s.cidr)+'</option>').join("");
  }

  $("reserveIpButton").addEventListener("click",()=>{populateAddressSubnet();$("addressForm").reset();populateAddressSubnet();$("addressDialog").showModal()});
  $("addressForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const subnetId=Number($("addressSubnet").value),s=state.data.subnets.find(x=>x.id===subnetId);
    if(!s)return;
    const body={subnet_id:subnetId,ip:$("addressIp").value.trim(),state:$("addressState").value,hostname:$("addressHostname").value.trim(),mac:$("addressMac").value.trim(),owner:$("addressOwner").value.trim(),notes:$("addressNotes").value.trim()};
    try{ipToInt(body.ip);if(!ipInCidr(body.ip,s.cidr))throw new Error("IP is outside "+s.cidr)}catch(err){toast("Invalid IP address",err.message,"error");return}
    if(state.mode==="live"){
      try{const result=await fetchJson("/api/addresses",{method:"POST",body:JSON.stringify(body)});$("addressDialog").close();await loadData();toast("Address reserved",result.ip)}
      catch(err){toast("Could not reserve address",err.message,"error")}
      return;
    }
    if(state.data.addresses.some(a=>a.ip===body.ip)){toast("Address conflict",body.ip+" already exists in IPAM.","error");return}
    const id=Math.max(0,...state.data.addresses.map(a=>a.id))+1;
    state.data.addresses.push({id,...body,subnet:s.name,site:s.site,updated_at:new Date().toISOString()});
    s.used=Math.min(s.total_hosts,s.used+1);s.updated_at=new Date().toISOString();
    addAudit("Jim Camus","Address reserved",body.ip+" reserved as "+body.state+" in "+s.name,subnetId);
    persistDemo();$("addressDialog").close();renderAll();toast("Address reserved",body.ip);
  });

  function downloadCsv(filename,rows){
    const csv=rows.map(r=>r.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\r\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  $("exportSubnetsButton").addEventListener("click",()=>downloadCsv("ipam-subnets.csv",[
    ["Name","CIDR","Site","Department","VLAN","Gateway","DNS1","DNS2","Used","Usable"],
    ...(state.data?.subnets||[]).map(s=>[s.name,s.cidr,s.site,s.department,s.vlan_id,s.gateway,s.dns1,s.dns2,s.used,s.total_hosts])
  ]));
  $("exportAddressesButton").addEventListener("click",()=>downloadCsv("ipam-addresses.csv",[
    ["IP","State","Hostname","MAC","Owner","Subnet","Site","Notes"],
    ...(state.data?.addresses||[]).map(a=>[a.ip,a.state,a.hostname,a.mac,a.owner,a.subnet,a.site,a.notes])
  ]));

  $("subnetSearch").addEventListener("input",renderSubnets);
  $("subnetSiteFilter").addEventListener("change",renderSubnets);
  $("subnetStateFilter").addEventListener("change",renderSubnets);
  $("addressSearch").addEventListener("input",renderAddresses);
  $("addressStateFilter").addEventListener("change",renderAddresses);
  $("addressSubnetFilter").addEventListener("change",renderAddresses);
  $("calculateButton").addEventListener("click",calculatePlanner);
  $("commitSplitButton").addEventListener("click",commitSelectedChildren);
  $("refreshButton").addEventListener("click",()=>loadData(true));

  const conn=$("connectionDialog");
  $("connectionButton").addEventListener("click",()=>{qsa('input[name="mode"]').forEach(r=>r.checked=r.value===state.mode);$("backendUrlInput").value=state.backendUrl;conn.showModal()});
  $("saveConnectionButton").addEventListener("click",()=>{
    const mode=qsa('input[name="mode"]').find(r=>r.checked)?.value||"demo";
    const url=$("backendUrlInput").value.trim().replace(/\/$/,"");
    if(mode==="live"&&!/^https?:\/\//i.test(url)){toast("Invalid backend URL","Use http://127.0.0.1:8810","error");return}
    state.mode=mode;state.backendUrl=url||"http://127.0.0.1:8810";
    localStorage.setItem("ipam_mode",mode);localStorage.setItem("ipam_backend_url",state.backendUrl);
    conn.close();state.data=null;loadData(true);
  });

  function renderAll(){
    if(!state.data)return;
    $("lastRefresh").textContent=(state.lastRefresh||new Date()).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    renderOverview();renderSubnets();renderAddresses();renderVlans();renderAudit();populateAddressSubnet();
    if(state.activePage==="planner")renderPlanner();
  }

  setInterval(()=>{if(state.mode==="live"&&document.visibilityState==="visible")loadData(false)},45000);
  loadData();
})();