export function systemInformationIndexJs() {
  return String.raw`const call = (context, cmd, args) => context.invoke(cmd, args || {});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function section(title, rows) {
  return '<section class="qx-raycast-section"><h2>' + escapeHtml(title) + '</h2>' + rows.join("") + '</section>';
}

function row(icon, title, detail, actions = "") {
  return '<div class="qx-raycast-row"><div class="qx-raycast-icon">' + escapeHtml(icon) + '</div><div class="qx-raycast-main"><div class="qx-raycast-title">' + escapeHtml(title) + '</div><div class="qx-raycast-detail">' + escapeHtml(detail) + '</div></div>' + actions + '</div>';
}

function styles() {
  return '<style>' +
    'body{font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--qx-text-primary,#111);background:transparent;margin:0;}' +
    '.qx-raycast-wrap{box-sizing:border-box;height:100%;overflow:auto;padding:14px 18px 28px;}' +
    '.qx-raycast-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;}' +
    '.qx-raycast-header h1{font-size:18px;line-height:1.2;margin:0;font-weight:650;}' +
    '.qx-raycast-header button,.qx-raycast-action{border:1px solid var(--qx-border-1,#ddd);background:var(--qx-bg-component-1,#fff);color:inherit;border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer;}' +
    '.qx-raycast-section{border-top:1px solid var(--qx-border-1,#ddd);padding-top:10px;margin-top:12px;}' +
    '.qx-raycast-section h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--qx-text-tertiary,#888);margin:0 0 8px;}' +
    '.qx-raycast-row{min-height:38px;display:flex;align-items:center;gap:10px;border-radius:6px;padding:7px 8px;}' +
    '.qx-raycast-row:hover{background:var(--qx-bg-component-2,#f5f5f5);}' +
    '.qx-raycast-icon{width:22px;text-align:center;flex:0 0 22px;}' +
    '.qx-raycast-main{min-width:0;flex:1;}' +
    '.qx-raycast-title{font-weight:560;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.qx-raycast-detail{margin-top:2px;color:var(--qx-text-secondary,#666);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.qx-raycast-error{color:var(--qx-danger,#c00);padding:16px;}' +
    '</style>';
}

async function loadAll(context) {
  const [system, storage, network, processes] = await Promise.all([
    call(context, "qx_system_information_check_system_info"),
    call(context, "qx_system_information_check_storage"),
    call(context, "qx_system_information_check_network"),
    call(context, "qx_system_information_list_processes"),
  ]);
  return { system, storage, network, processes };
}

async function renderSystemInformation(container, context) {
  container.innerHTML = styles() + '<div class="qx-raycast-wrap">Loading system information...</div>';
  try {
    const data = await loadAll(context);
    const processRows = (data.processes.processes || []).slice(0, 80).map((proc) =>
      row("A", proc.name, "PID: " + proc.pid + " | CPU: " + Number(proc.cpu || 0).toFixed(1) + "% | MEM: " + Number(proc.mem || 0).toFixed(1) + "%")
    );
    const networkRows = (data.network.devices || []).map((device) => row("N", device.name, device.ip));

    container.innerHTML = styles() + '<div class="qx-raycast-wrap">' +
      '<div class="qx-raycast-header"><h1>System Information</h1><button id="qx-refresh">Refresh</button></div>' +
      section("About This Mac", [
        row("H", "Hostname", data.system.hostname),
        row("C", "Chip", data.system.chip),
        row("M", "Memory", data.system.memory),
        row("#", "Serial Number", data.system.serialNumber),
      ]) +
      section("Storage", [row("D", "Macintosh HD", data.storage.summary)]) +
      section("macOS", [
        row("i", data.system.macOS, "Kernel " + data.system.kernel),
      ]) +
      section("Network", networkRows.length ? networkRows : [row("N", "No active IPv4 network devices", "-")]) +
      section("Running Processes", processRows.length ? processRows : [row("A", "No processes", "-")]) +
      '</div>';
    container.querySelector("#qx-refresh")?.addEventListener("click", () => renderSystemInformation(container, context));
  } catch (error) {
    container.innerHTML = styles() + '<div class="qx-raycast-error">Failed to load system information: ' + escapeHtml(error) + '</div>';
  }
}

function toastJson(context, title, value) {
  const compact = typeof value === "string" ? value : JSON.stringify(value);
  context.showToast(title + ": " + compact.slice(0, 220));
}

export default {
  commands: [
    {
      name: "index",
      title: "View System Information",
      async run(context) {
        toastJson(context, "System Information", await call(context, "qx_system_information_check_system_info"));
      },
    },
    {
      name: "check-storage",
      title: "Check Storage",
      async run(context) {
        const result = await call(context, "qx_system_information_check_storage");
        context.showToast(result.summary);
      },
    },
    {
      name: "check-system-info",
      title: "Check System Info",
      async run(context) {
        toastJson(context, "System", await call(context, "qx_system_information_check_system_info"));
      },
    },
    {
      name: "check-network",
      title: "Check Network",
      async run(context) {
        const result = await call(context, "qx_system_information_check_network");
        context.showToast(result.count + " network device(s)");
      },
    },
    {
      name: "list-processes",
      title: "List Processes",
      async run(context) {
        const result = await call(context, "qx_system_information_list_processes");
        context.showToast(result.count + " running process(es)");
      },
    },
    {
      name: "kill-process",
      title: "Kill Process",
      async run(context) {
        const pid = await context.prompt("PID to kill");
        if (!pid) return;
        const result = await call(context, "qx_system_information_kill_process", { pid: Number(pid) });
        context.showToast(result.message);
      },
    },
  ],
  panel: {
    title: "System Information",
    render(container, context) {
      void renderSystemInformation(container, context);
    },
    destroy(container) {
      container.innerHTML = "";
    },
  },
};
`;
}

export function systemMonitorIndexJs() {
  return String.raw`function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}
function bytes(v){const n=Math.max(0,Number(v||0));if(n<1024)return Math.round(n)+" B";if(n<1048576)return(n/1024).toFixed(2)+" KB";if(n<1073741824)return(n/1048576).toFixed(2)+" MB";return(n/1073741824).toFixed(2)+" GB"}
function css(){return '<style>:root{--b:#f7f7f7;--p:#fff;--p2:#ededed;--l:#d7d7d7;--t:#111;--m:#777;--s:#222}@media(prefers-color-scheme:dark){:root{--b:#1e1e1f;--p:#252526;--p2:#3a3a3c;--l:#3c3c3f;--t:#f5f5f5;--m:#a9a9aa;--s:#fff}}html,body,#root{margin:0;width:100%;height:100%;background:transparent}body{font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--t)}.sm{height:100%;display:grid;grid-template-columns:minmax(220px,32%) minmax(0,1fr);background:var(--b)}.nav{border-right:1px solid var(--l);padding:22px 16px;overflow:auto}.nav button{width:100%;min-height:52px;display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:10px;border:0;border-radius:8px;background:transparent;color:var(--t);font:inherit;text-align:left;padding:8px 12px;cursor:pointer}.nav button.active{background:var(--p2)}.label{font-size:16px;font-weight:650}.metric{color:var(--m);font-size:14px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.detail{padding:24px 30px;overflow:auto}.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.top h1{font-size:22px;margin:0}.top button{border:1px solid var(--l);background:var(--p);color:var(--t);border-radius:6px;padding:7px 12px;font:inherit}.row{min-height:42px;display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid var(--l);padding:8px 0}.name{color:var(--m);font-weight:650}.value{font-size:15px;font-weight:650;text-align:right}.bar{height:8px;background:var(--p2);border-radius:999px;overflow:hidden}.fill{height:100%;background:var(--s);border-radius:999px}.error{padding:20px;color:#d44}.small{font-size:12px;color:var(--m)}</style>'}
function row(n,v){return '<div class="row"><div class="name">'+esc(n)+'</div><div class="value">'+esc(v)+'</div></div>'}
function bar(p){return '<div class="bar"><div class="fill" style="width:'+Math.max(0,Math.min(100,Number(p||0))).toFixed(0)+'%"></div></div>'}
function stat(st,snake,camel){return Number(st?.[snake]??st?.[camel]??0)}
let active="system-info",lastNet=null;
async function data(ctx){const [stats,system,storage,network,processes,power,counters]=await Promise.all([ctx.system.stats(),ctx.system.info(),ctx.system.storage(),ctx.system.network(),ctx.system.processes.list(),ctx.qx.invokeRust("qx_system_monitor_power",{}),ctx.qx.invokeRust("qx_system_monitor_network_counters",{})]);const now=Date.now();let down=0,up=0;if(lastNet&&counters){const s=Math.max(.001,(now-lastNet.time)/1000);down=Math.max(0,(Number(counters.totalBytesIn||0)-lastNet.in)/s);up=Math.max(0,(Number(counters.totalBytesOut||0)-lastNet.out)/s)}lastNet={time:now,in:Number(counters?.totalBytesIn||0),out:Number(counters?.totalBytesOut||0)};return{stats,system,storage,network,processes,power,counters,down,up}}
function nav(id,i,l,m){return '<button data-tab="'+id+'" class="'+(active===id?'active':'')+'"><span>'+i+'</span><span class="label">'+l+'</span><span class="metric">'+esc(m||'')+'</span></button>'}
function pane(d){const st=d.stats||{};if(active==="cpu")return '<div class="top"><h1>CPU</h1><button id="refresh">Refresh</button></div>'+bar(st.cpu)+row("Usage",Number(st.cpu||0).toFixed(1)+" %")+row("Chip",d.system?.chip||"Unknown")+row("Temperature","N/A");if(active==="memory")return '<div class="top"><h1>Memory</h1><button id="refresh">Refresh</button></div>'+bar(st.memory)+row("Used",stat(st,"memory_used_gb","memoryUsedGb").toFixed(2)+" GB")+row("Total",stat(st,"memory_total_gb","memoryTotalGb").toFixed(2)+" GB")+row("Usage",Number(st.memory||0).toFixed(1)+" %");if(active==="power")return '<div class="top"><h1>Power</h1><button id="refresh">Refresh</button></div>'+(d.power?.batteryLevel==null?'':bar(d.power.batteryLevel))+row("Battery",d.power?.batteryLevel==null?"N/A":d.power.batteryLevel+" %")+row("Source",d.power?.source||"Unknown")+row("State",d.power?.summary||"Unknown");if(active==="network"){const dev=(d.network?.devices||[]).map(x=>row(x.name,x.ip)).join("");const c=(d.counters?.interfaces||[]).slice(0,8).map(x=>row(x.name,"In "+bytes(x.bytesIn)+" / Out "+bytes(x.bytesOut))).join("");return '<div class="top"><h1>Network</h1><button id="refresh">Refresh</button></div>'+row("Download Speed",bytes(d.down)+"/s")+row("Upload Speed",bytes(d.up)+"/s")+row("Active Devices",String(d.network?.count||0))+dev+c}const ps=(d.processes?.processes||[]).slice(0,8).map((p,i)=>'<div class="row"><div><strong>'+(i+1)+' -> '+esc(p.name)+'</strong><div class="small">PID '+p.pid+'</div></div><div class="value">CPU '+Number(p.cpu||0).toFixed(1)+'% / MEM '+Number(p.mem||0).toFixed(1)+'%</div></div>').join("");return '<div class="top"><h1>System Info</h1><button id="refresh">Refresh</button></div>'+row("Hostname",d.system?.hostname||"Unknown")+row("macOS",d.system?.macOS||"Unknown")+row("Kernel",d.system?.kernel||"Unknown")+row("Storage",d.storage?.summary||"Unknown")+row("Serial Number",d.system?.serialNumber||"Unknown")+ps}
async function draw(c,ctx){c.innerHTML=css()+'<div class="sm"><div class="nav">Loading System Monitor...</div><div></div></div>';try{const d=await data(ctx);c.innerHTML=css()+'<div class="sm"><div class="nav">'+nav("system-info","S","System Info","")+nav("cpu","C","CPU",Number(d.stats?.cpu||0).toFixed(0)+" %")+nav("memory","M","Memory",Number(d.stats?.memory||0).toFixed(0)+" %")+nav("power","P","Power",d.power?.batteryLevel==null?"N/A":d.power.batteryLevel+" %")+nav("network","N","Network","↓ "+bytes(d.down)+"/s")+'</div><div class="detail">'+pane(d)+'</div></div>';c.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{active=b.getAttribute("data-tab")||"system-info";draw(c,ctx)}));c.querySelector("#refresh")?.addEventListener("click",()=>draw(c,ctx))}catch(e){c.innerHTML=css()+'<div class="error">Failed to load System Monitor: '+esc(e?.message||e)+'</div>'}}
export default{commands:[{name:"system-monitor",title:"System Monitor",async run(ctx){const s=await ctx.system.stats();ctx.showToast("CPU "+Number(s.cpu||0).toFixed(1)+"%, Memory "+Number(s.memory||0).toFixed(1)+"%")}},{name:"menubar-system-monitor",title:"Menubar System Monitor",async run(ctx){const s=await ctx.system.stats();ctx.showToast("Qx panel monitor ready: CPU "+Number(s.cpu||0).toFixed(1)+"%")}}],panel:{title:"System Monitor",render(c,ctx){void draw(c,ctx);c.__timer=ctx.setInterval(()=>draw(c,ctx),3000)},destroy(c){c.innerHTML=""}}};
`;
}
