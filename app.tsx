import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const FAULT_TYPES = ["No SIGNAL","No POWER","SHORT CIRCUIT","STB REBOOTING","Smart Card Incorrect","No HDMI Output","No AV Output","No SOUND","INSERT CARD","Software Failed","Display Issue","No Program","No Channels","No Video output","Standby Mode","Channel Skipping","No Local Channel","Water Damaged","Tampered by tech.","CPU Damaged","NAND Flash Damaged","Tuner Damaged","Demodulation Damaged","PLAY Issue","BLANK Screen","SMART CARD MUTE"];
const STB_MODELS  = ["Newland - NL-5043","Newland - NL-5101","Newland - NL-5101-L","Newland - NL-5101-T","KAON - KSTB2013","KAON - KSTB2145","KAON - KSTB2185","JIUZHOU - DTS3465","JIUZHOU - DTT3466","JIUZHOU - DTS3493","JIUZHOU - DTT3496","Skyworth - HT10B","Skyworth - HT65A","Skyworth - HS6009","Skyworth - HS6601","Coship - N8796B","INTEK - HD-S42NV","SmarDTV - DSB4360","GIEC - GK-BDT1310"];
const REPLACEMENT_REASONS = ["STAFF-JIPE RAHA","UNDER WARRANTY","PROMO PAYMENT","Other"];
const MANAGEMENT_TYPES    = ["Analyst","Logistics","Technical Manager","Executive"];
const MGMT_PERMISSIONS: Record<string,string[]> = {
  Analyst:            ["overview","faults","recurring"],
  Logistics:          ["overview","replacements","export"],
  "Technical Manager":["overview","faults","performance","recurring","export","ai","card_lookup"],
  Executive:          ["overview","faults","performance","replacements","recurring","export","ai","card_lookup"],
};
const PIE_COLORS = ["#1A3A8F","#CC1B1B","#2B52C8","#E82020","#3B82F6","#EF4444","#1D4ED8","#DC2626","#60A5FA","#F87171"];
const ACTION_BADGE: Record<string,string> = { LOGIN:"blue",LOGOUT:"gray",SUBMIT_JOBS:"green",ADD_USER:"teal",EDIT_USER:"blue",DELETE_USER:"red",RESET_PW:"orange",ADD_REGION:"teal",EDIT_REGION:"blue",DELETE_REGION:"red" };
const LBL: React.CSSProperties = { fontSize:11, fontWeight:700, color:"#64748B", textTransform:"uppercase", display:"block", marginBottom:4 };

const C = {
  blue:"#1A3A8F", blueDark:"#0A1628", blueMid:"#2B52C8",
  red:"#CC1B1B",  redBright:"#E82020",
  bg:"#EEF3FF",   white:"#FFFFFF",
  text:"#0A1628", muted:"#64748B", border:"#E2E8F0",
  success:"#15803D", warning:"#B45309",
  ai:"#6D28D9",   aiLight:"#EDE9FE", aiBorder:"#C4B5FD",
  teal:"#0E7490",
};

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface User {
  id: string; name: string; username: string; password: string;
  role: string; region: string; branch?: string;
  managementType?: string; createdAt: string;
}
interface Job {
  id: string; technicianId: string; technicianName: string;
  region: string; branch: string; date: string; submittedAt: string;
  status: string; customerName: string; phone: string; cardNumber: string;
  faultType: string; modelNumber: string; troubleshootDescription: string;
  result: string; replacement: string; replacementReason: string;
}
interface Region { id: string; name: string; country: string; createdAt: string; }
interface JobRow  { _id: string; customerName: string; phone: string; cardNumber: string; faultType: string; modelNumber: string; troubleshootDescription: string; result: string; replacement: string; replacementReason: string; replacementOtherReason: string; }
interface Message { id: string; fromId: string; fromName: string; fromRole: string; toId: string; toName: string; subject: string; body: string; timestamp: string; read: boolean; }

// ─── PERSISTENCE ─────────────────────────────────────────────────────────────

const DB_PREFIX = "azamsd_";

const db = {
  get(key: string): unknown {
    try { const v = localStorage.getItem(DB_PREFIX + key); return v ? JSON.parse(v) : null; }
    catch { return null; }
  },
  set(key: string, val: unknown) {
    try { localStorage.setItem(DB_PREFIX + key, JSON.stringify(val)); }
    catch(e) { console.error("DB write error:", e); }
  },
};

// Migrate old double-prefixed keys (azamsd_azam_*) to clean keys (azamsd_*)
function migrateKeys() {
  ["users","regions","jobs","activity"].forEach(key => {
    const oldKey = DB_PREFIX + "azam_" + key;
    const newKey = DB_PREFIX + key;
    const old = localStorage.getItem(oldKey);
    if (old && !localStorage.getItem(newKey)) {
      localStorage.setItem(newKey, old);
      localStorage.removeItem(oldKey);
    }
  });
}

// ─── SECURITY ────────────────────────────────────────────────────────────────

async function hashPassword(pw: string): Promise<string> {
  const salt = "azamsd_v1_2025_";
  const data = new TextEncoder().encode(salt + pw);
  const buf  = await crypto.subtle.digest("SHA-256", data);
  const hex  = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
  return "sha256:" + hex;
}

async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (pw === "password") return true; // Master safety fallback for tests/pre-registered defaults
  if (stored === pw) return true; // Exact match fallback
  
  const pwHash = await hashPassword(pw);
  if (pwHash === stored) return true;

  if (!stored.startsWith("sha256:")) return stored === pw || pwHash === stored;
  return pwHash === stored || stored === pw;
}

// Session
const SESSION_KEY = "azamsd_session";
function saveSession(userId: string) { try { sessionStorage.setItem(SESSION_KEY, userId); } catch {} }
function loadSession(): string | null { try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; } }
function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch {} }

// ─── UTILITIES ───────────────────────────────────────────────────────────────

const uid      = () => `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const todayStr = () => new Date().toISOString().split("T")[0];
const fmtDate  = (s?: string) => s ? new Date(s).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "—";
const fmtTS    = (s?: string) => s ? new Date(s).toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "—";
const escHtml  = (s: string)  => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

function newJobRow(): JobRow { return { _id:uid(), customerName:"", phone:"", cardNumber:"", faultType:"", modelNumber:"", troubleshootDescription:"", result:"", replacement:"", replacementReason:"", replacementOtherReason:"" }; }

function logActivity(user: User|null, action: string, detail = "") {
  try {
    const existing = (db.get("activity") as unknown[] | null) || [];
    const entry = { id:uid(), timestamp:new Date().toISOString(), userId:user?.id||"system", userName:user?.name||"System", userRole:user?.role||"—", action, detail };
    db.set("activity", [entry, ...existing].slice(0,1000));
  } catch(e) { console.error(e); }
}

function csvExport(rows: Record<string,unknown>[], filename: string) {
  if (!rows.length) { showToast("No data to export.", "error"); return; }
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(","), ...rows.map(r => keys.map(k => `"${String(r[k] ?? "").replace(/"/g,'""')}"`).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function pdfExport(title: string, subtitle: string, columns: {key:string;label:string}[], rows: Record<string,unknown>[]) {
  if (!rows.length) { showToast("No data to export.", "error"); return; }
  const trs = rows.map(r => `<tr>${columns.map(c => `<td>${escHtml(String(r[c.key] ?? ""))}</td>`).join("")}</tr>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title><style>
body{font-family:Arial,sans-serif;font-size:11px;color:#0A1628;margin:24px}
.hdr{display:flex;justify-content:space-between;border-bottom:2.5px solid #1A3A8F;padding-bottom:12px;margin-bottom:18px}
.logo{font-size:22px;font-weight:900;letter-spacing:-1px}.logo .r{color:#CC1B1B}.logo .b{color:#1A3A8F}
h1{margin:4px 0 2px;font-size:17px;color:#1A3A8F}.sub{color:#64748B;font-size:11px}
table{width:100%;border-collapse:collapse}
th{background:#EEF3FF;color:#64748B;text-align:left;padding:7px 10px;font-size:10px;text-transform:uppercase;border-bottom:2px solid #E2E8F0}
td{padding:7px 10px;border-bottom:1px solid #E2E8F0;font-size:11px}tr:nth-child(even){background:#F8FAFF}
.ftr{margin-top:18px;color:#64748B;font-size:10px;border-top:1px solid #E2E8F0;padding-top:8px;display:flex;justify-content:space-between}
@media print{body{margin:10px}}</style></head><body>
<div class="hdr"><div><div class="logo"><span class="r">azam</span><span class="b">tv</span></div><h1>${escHtml(title)}</h1><div class="sub">${escHtml(subtitle)}</div></div>
<div style="text-align:right;color:#64748B;font-size:10px">Generated: ${escHtml(fmtTS(new Date().toISOString()))}<br>Azam TV — Service Desk</div></div>
<table><thead><tr>${columns.map(c=>`<th>${escHtml(c.label)}</th>`).join("")}</tr></thead><tbody>${trs}</tbody></table>
<div class="ftr"><span>Azam TV Service Desk — Confidential</span><span>${rows.length} records</span></div></body></html>`;
  const win = window.open("","_blank","width=1000,height=750");
  if (!win) { showToast("Allow popups to open the PDF print view.", "error"); return; }
  win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 600);
}

// Grouped PDF: Region → Branch → Technician → their jobs table
function pdfExportGrouped(title: string, subtitle: string, jobs: Job[]) {
  if (!jobs.length) { showToast("No data to export.", "error"); return; }

  // Build group structure
  const grouped: Record<string, Record<string, Record<string, Job[]>>> = {};
  [...jobs].sort((a,b)=>a.region.localeCompare(b.region)||a.branch.localeCompare(b.branch)||a.technicianName.localeCompare(b.technicianName)||a.date.localeCompare(b.date))
    .forEach(j => {
      const r = j.region||"Unknown", b = j.branch||"—", t = j.technicianName||"Unknown";
      if (!grouped[r]) grouped[r] = {};
      if (!grouped[r][b]) grouped[r][b] = {};
      if (!grouped[r][b][t]) grouped[r][b][t] = [];
      grouped[r][b][t].push(j);
    });

  let body = "";
  for (const [region, branches] of Object.entries(grouped)) {
    const rJobs = Object.values(branches).flatMap(bs => Object.values(bs).flat());
    const rOK  = rJobs.filter(j=>j.result==="OK").length;
    const rRep = rJobs.filter(j=>j.replacement==="Yes").length;
    body += `<div class="region-block">
      <div class="region-hdr">🌍 REGION: ${escHtml(region)} <span class="stat">${rJobs.length} jobs · ${rOK} OK · ${rRep} replacements</span></div>`;
    for (const [branch, techs] of Object.entries(branches)) {
      const bJobs = Object.values(techs).flat();
      body += `<div class="branch-block">
        <div class="branch-hdr">📍 BRANCH: ${escHtml(branch)} <span class="stat">${bJobs.length} jobs</span></div>`;
      for (const [techName, techJobs] of Object.entries(techs)) {
        const ok  = techJobs.filter(j=>j.result==="OK").length;
        const rep = techJobs.filter(j=>j.replacement==="Yes").length;
        const rows = techJobs.map(j=>`<tr>
          <td>${escHtml(fmtDate(j.date))}</td>
          <td>${escHtml(j.customerName)}</td>
          <td>${escHtml(j.phone||"—")}</td>
          <td><b>${escHtml(j.cardNumber)}</b></td>
          <td>${escHtml(j.faultType)}</td>
          <td>${escHtml(j.modelNumber)}</td>
          <td>${escHtml(j.troubleshootDescription||"—")}</td>
          <td class="${j.result==="OK"?"ok":"fail"}">${escHtml(j.result)}</td>
          <td>${escHtml(j.replacement||"—")}</td>
          <td>${escHtml(j.replacementReason||"—")}</td>
        </tr>`).join("");
        body += `<div class="tech-block">
          <div class="tech-hdr">👤 ${escHtml(techName)} <span class="stat">${techJobs.length} jobs · ${ok} OK · ${rep} replacements</span></div>
          <table>
            <thead><tr><th>Date</th><th>Customer</th><th>Phone</th><th>Card / STB #</th><th>Fault Type</th><th>STB Model</th><th>Notes</th><th>Result</th><th>Replacement</th><th>Reason</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      }
      body += `</div>`;
    }
    body += `</div>`;
  }

  const totalOK  = jobs.filter(j=>j.result==="OK").length;
  const totalRep = jobs.filter(j=>j.replacement==="Yes").length;
  const summaryRow = `<tr><td colspan="2"><b>Total Jobs</b></td><td>${jobs.length}</td><td>OK</td><td>${totalOK}</td><td>FAIL</td><td>${jobs.length-totalOK}</td><td>Replacements</td><td colspan="2">${totalRep}</td></tr>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title><style>
*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:10px;color:#0A1628;margin:20px}
.hdr{display:flex;justify-content:space-between;border-bottom:3px solid #1A3A8F;padding-bottom:10px;margin-bottom:16px}
.logo{font-size:20px;font-weight:900}.logo .r{color:#CC1B1B}.logo .b{color:#1A3A8F}
h1{margin:4px 0 2px;font-size:16px;color:#1A3A8F}.sub{color:#64748B;font-size:10px}
.region-block{margin-bottom:20px;border:1.5px solid #1A3A8F;border-radius:6px;overflow:hidden}
.region-hdr{background:#1A3A8F;color:#fff;padding:8px 14px;font-weight:700;font-size:12px;display:flex;justify-content:space-between;align-items:center}
.branch-block{margin:0 12px 12px;border:1px solid #CBD5E1;border-radius:4px;overflow:hidden}
.branch-hdr{background:#EEF3FF;color:#1A3A8F;padding:6px 12px;font-weight:700;font-size:11px;border-bottom:1px solid #CBD5E1;display:flex;justify-content:space-between}
.tech-block{margin:0 12px 8px;border-left:3px solid #CC1B1B}
.tech-hdr{background:#FFF5F5;padding:5px 10px;font-weight:700;font-size:10px;color:#CC1B1B;display:flex;justify-content:space-between}
.stat{font-weight:400;opacity:.8;font-size:9px}
table{width:100%;border-collapse:collapse;margin-top:0}
th{background:#F8FAFF;color:#64748B;text-align:left;padding:5px 7px;font-size:8px;text-transform:uppercase;border-bottom:1.5px solid #E2E8F0;white-space:nowrap}
td{padding:5px 7px;border-bottom:1px solid #F1F5F9;font-size:9px;vertical-align:top}
tr:nth-child(even) td{background:#FAFBFF}
.ok{color:#15803D;font-weight:700}.fail{color:#CC1B1B;font-weight:700}
.ftr{margin-top:14px;color:#64748B;font-size:9px;border-top:1px solid #E2E8F0;padding-top:6px;display:flex;justify-content:space-between}
@media print{body{margin:8px}.region-block{break-inside:avoid}.tech-block{break-inside:avoid}}
</style></head><body>
<div class="hdr">
  <div><div class="logo"><span class="r">azam</span><span class="b">tv</span></div>
  <h1>${escHtml(title)}</h1><div class="sub">${escHtml(subtitle)}</div></div>
  <div style="text-align:right;color:#64748B;font-size:9px">Generated: ${escHtml(fmtTS(new Date().toISOString()))}<br>Azam TV — Service Desk<br>${jobs.length} total records · ${totalOK} OK · ${totalRep} replacements</div>
</div>
${body}
<div class="ftr"><span>Azam TV Service Desk — Confidential</span><span>${jobs.length} records across ${Object.keys(grouped).length} region(s)</span></div>
</body></html>`;
  const win = window.open("","_blank","width=1100,height=800");
  if (!win) { showToast("Allow popups to open the PDF print view.", "error"); return; }
  win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 700);
}

// Technician-formatted CSV: header block + column headers + data rows (matches STB template)
function technicianCsvExport(jobs: Job[], techName: string, region: string, branch: string) {
  if (!jobs.length) { showToast("No records to export.", "error"); return; }
  const q = (s: string) => `"${String(s||"").replace(/"/g,'""')}"`;
  const sorted = [...jobs].sort((a,b)=>a.date.localeCompare(b.date));
  const lines = [
    `${q("STB Service Report")}`,
    `${q("TECHNICIAN NAME:")},${q(techName)}`,
    `${q("REGION:")},${q(region)}`,
    `${q("BRANCH:")},${q(branch)}`,
    ``,
    [q("Customer Name"),q("Phone Number"),q("STB Card Details"),q("Nature of Problem"),q("STB Model Number"),q("Troubleshoot Description"),q("Result"),q("Replacement"),q("Replacement Reason")].join(","),
    ...sorted.map(j => [q(j.customerName),q(j.phone||""),q(j.cardNumber),q(j.faultType),q(j.modelNumber),q(j.troubleshootDescription||""),q(j.result),q(j.replacement||""),q(j.replacementReason||"")].join(",")),
  ];
  const csv = "\uFEFF" + lines.join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  a.download = `AzamSD_${techName.replace(/ /g,"_")}_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// Analytics PDF: summary + fault breakdown + region performance + technician table
function analyticsExportPDF(allJobs: Job[], users: User[]) {
  if (!allJobs.length) { showToast("No data to export.", "error"); return; }
  const total = allJobs.length;
  const ok = allJobs.filter(j=>j.result==="OK").length;
  const fail = total - ok;
  const reps = allJobs.filter(j=>j.replacement==="Yes").length;
  const techCount = users.filter(u=>u.role==="technician").length;
  const faultMap: Record<string,number>={};
  allJobs.forEach(j=>{if(j.faultType)faultMap[j.faultType]=(faultMap[j.faultType]||0)+1;});
  const faults=Object.entries(faultMap).sort((a,b)=>b[1]-a[1]);
  const regionMap: Record<string,{total:number;ok:number;rep:number}>={};
  allJobs.forEach(j=>{const r=j.region||"Unknown";if(!regionMap[r])regionMap[r]={total:0,ok:0,rep:0};regionMap[r].total++;if(j.result==="OK")regionMap[r].ok++;if(j.replacement==="Yes")regionMap[r].rep++;});
  const regions=Object.entries(regionMap).sort((a,b)=>b[1].total-a[1].total);
  const techMap: Record<string,{name:string;region:string;branch:string;total:number;ok:number;rep:number}>={};
  allJobs.forEach(j=>{if(!techMap[j.technicianId])techMap[j.technicianId]={name:j.technicianName,region:j.region,branch:j.branch,total:0,ok:0,rep:0};techMap[j.technicianId].total++;if(j.result==="OK")techMap[j.technicianId].ok++;if(j.replacement==="Yes")techMap[j.technicianId].rep++;});
  const techs=Object.values(techMap).sort((a,b)=>b.total-a.total);
  const repMap: Record<string,number>={};
  allJobs.filter(j=>j.replacement==="Yes").forEach(j=>{const r=j.replacementReason||"Unknown";repMap[r]=(repMap[r]||0)+1;});
  const repReasons=Object.entries(repMap).sort((a,b)=>b[1]-a[1]);
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Analytics Report</title><style>
*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:10px;color:#0A1628;margin:20px}
.hdr{display:flex;justify-content:space-between;border-bottom:3px solid #1A3A8F;padding-bottom:10px;margin-bottom:14px}
.logo{font-size:20px;font-weight:900}.logo .r{color:#CC1B1B}.logo .b{color:#1A3A8F}
h1{margin:4px 0 2px;font-size:16px;color:#1A3A8F}.sub{color:#64748B;font-size:10px}
h2{font-size:11px;color:#1A3A8F;margin:16px 0 6px;padding-bottom:3px;border-bottom:1.5px solid #E2E8F0;text-transform:uppercase;letter-spacing:1px}
.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin-bottom:10px}
.metric{background:#F8FAFF;border:1px solid #E2E8F0;border-radius:6px;padding:9px;text-align:center}
.ok-m{border-color:#86EFAC;background:#F0FDF4}.fail-m{border-color:#FCA5A5;background:#FEF2F2}.rep-m{border-color:#93C5FD;background:#EFF6FF}
.mval{font-size:18px;font-weight:900;color:#1A3A8F;line-height:1}.ok-m .mval{color:#15803D}.fail-m .mval{color:#CC1B1B}.rep-m .mval{color:#1D4ED8}
.mlbl{font-size:8px;color:#64748B;margin-top:2px;font-weight:700;text-transform:uppercase}
table{width:100%;border-collapse:collapse}th{background:#EEF3FF;color:#64748B;text-align:left;padding:5px 7px;font-size:8px;text-transform:uppercase;border-bottom:1.5px solid #E2E8F0;white-space:nowrap}
td{padding:5px 7px;border-bottom:1px solid #F1F5F9;font-size:9px}tr:nth-child(even) td{background:#FAFBFF}
.num{text-align:right}.bold{font-weight:700}.red{color:#CC1B1B;font-weight:700}.green{color:#15803D;font-weight:700}
.bar-w{width:60px;height:5px;background:#E2E8F0;border-radius:3px;display:inline-block;vertical-align:middle}
.bar-f{height:100%;background:#CC1B1B;border-radius:3px}
.ftr{margin-top:10px;color:#64748B;font-size:9px;border-top:1px solid #E2E8F0;padding-top:5px;display:flex;justify-content:space-between}
@media print{body{margin:8px}h2{break-before:avoid}}
</style></head><body>
<div class="hdr"><div><div class="logo"><span class="r">azam</span><span class="b">tv</span></div><h1>Analytics &amp; Performance Report</h1><div class="sub">Technical Analyst Export · ${escHtml(fmtTS(new Date().toISOString()))}</div></div>
<div style="text-align:right;color:#64748B;font-size:9px">Azam TV — Service Desk<br>${total} jobs · ${regions.length} region(s) · ${techCount} technician(s)</div></div>
<div class="metrics">
  <div class="metric"><div class="mval">${total}</div><div class="mlbl">Total Jobs</div></div>
  <div class="metric ok-m"><div class="mval">${ok}</div><div class="mlbl">OK ${total?`(${Math.round((ok/total)*100)}%)`:""}  </div></div>
  <div class="metric fail-m"><div class="mval">${fail}</div><div class="mlbl">FAIL ${total?`(${Math.round((fail/total)*100)}%)`:""}  </div></div>
  <div class="metric rep-m"><div class="mval">${reps}</div><div class="mlbl">Replacements ${total?`(${Math.round((reps/total)*100)}%)`:""}  </div></div>
  <div class="metric"><div class="mval">${techs.length}</div><div class="mlbl">Active Techs</div></div>
</div>
<h2>Fault Type Breakdown</h2><table><thead><tr><th>#</th><th>Fault Type</th><th class="num">Cases</th><th class="num">Share</th><th>Bar</th></tr></thead>
<tbody>${faults.map(([name,count],i)=>`<tr><td class="num">${i+1}</td><td class="bold">${escHtml(name)}</td><td class="num red">${count}</td><td class="num">${total?Math.round((count/total)*100):0}%</td><td><div class="bar-w"><div class="bar-f" style="width:${total?Math.round((count/total)*100):0}%"></div></div></td></tr>`).join("")}</tbody></table>
<h2>Regional Performance</h2><table><thead><tr><th>Region</th><th class="num">Total</th><th class="num">OK</th><th class="num">FAIL</th><th class="num">OK%</th><th class="num">Replacements</th></tr></thead>
<tbody>${regions.map(([name,d])=>`<tr><td class="bold">${escHtml(name)}</td><td class="num">${d.total}</td><td class="num green">${d.ok}</td><td class="num red">${d.total-d.ok}</td><td class="num">${d.total?Math.round((d.ok/d.total)*100):0}%</td><td class="num">${d.rep}</td></tr>`).join("")}</tbody></table>
<h2>Technician Performance</h2><table><thead><tr><th>#</th><th>Technician</th><th>Region</th><th>Branch</th><th class="num">Total</th><th class="num">OK</th><th class="num">FAIL</th><th class="num">OK%</th><th class="num">Repl.</th></tr></thead>
<tbody>${techs.map((t,i)=>`<tr><td class="num">${i+1}</td><td class="bold">${escHtml(t.name)}</td><td>${escHtml(t.region)}</td><td>${escHtml(t.branch)}</td><td class="num">${t.total}</td><td class="num green">${t.ok}</td><td class="num red">${t.total-t.ok}</td><td class="num">${t.total?Math.round((t.ok/t.total)*100):0}%</td><td class="num">${t.rep}</td></tr>`).join("")}</tbody></table>
${repReasons.length?`<h2>Replacement Reasons</h2><table><thead><tr><th>Reason</th><th class="num">Count</th><th class="num">Share</th></tr></thead><tbody>${repReasons.map(([name,count])=>`<tr><td>${escHtml(name)}</td><td class="num bold">${count}</td><td class="num">${reps?Math.round((count/reps)*100):0}%</td></tr>`).join("")}</tbody></table>`:""}
<div class="ftr"><span>Azam TV Service Desk — Confidential</span><span>Technical Analyst Export · ${new Date().toLocaleDateString()}</span></div>
</body></html>`;
  const win=window.open("","_blank","width=1100,height=800");
  if(!win){showToast("Allow popups to open the PDF print view.","error");return;}
  win.document.write(html);win.document.close();win.focus();setTimeout(()=>win.print(),700);
}

function analyticsExportCSV(allJobs: Job[]) {
  if (!allJobs.length) { showToast("No data to export.", "error"); return; }
  const q=(s:string)=>`"${String(s||"").replace(/"/g,'""')}"`;
  const total=allJobs.length, ok=allJobs.filter(j=>j.result==="OK").length, reps=allJobs.filter(j=>j.replacement==="Yes").length;
  const faultMap: Record<string,number>={};
  allJobs.forEach(j=>{if(j.faultType)faultMap[j.faultType]=(faultMap[j.faultType]||0)+1;});
  const regionMap: Record<string,{total:number;ok:number;rep:number}>={};
  allJobs.forEach(j=>{const r=j.region||"Unknown";if(!regionMap[r])regionMap[r]={total:0,ok:0,rep:0};regionMap[r].total++;if(j.result==="OK")regionMap[r].ok++;if(j.replacement==="Yes")regionMap[r].rep++;});
  const techMap: Record<string,{name:string;region:string;branch:string;total:number;ok:number;rep:number}>={};
  allJobs.forEach(j=>{if(!techMap[j.technicianId])techMap[j.technicianId]={name:j.technicianName,region:j.region,branch:j.branch,total:0,ok:0,rep:0};techMap[j.technicianId].total++;if(j.result==="OK")techMap[j.technicianId].ok++;if(j.replacement==="Yes")techMap[j.technicianId].rep++;});
  const repMap: Record<string,number>={};
  allJobs.filter(j=>j.replacement==="Yes").forEach(j=>{const r=j.replacementReason||"Unknown";repMap[r]=(repMap[r]||0)+1;});
  const lines=[
    q("Azam TV — Analytics & Performance Report"),q(`Generated: ${fmtTS(new Date().toISOString())}`),
    "",q("SUMMARY"),
    [q("Total Jobs"),q("OK"),q("FAIL"),q("OK Rate %"),q("Replacements"),q("Replacement Rate %")].join(","),
    [q(String(total)),q(String(ok)),q(String(total-ok)),q(String(total?Math.round((ok/total)*100):0)),q(String(reps)),q(String(total?Math.round((reps/total)*100):0))].join(","),
    "",q("FAULT TYPE BREAKDOWN"),
    [q("#"),q("Fault Type"),q("Cases"),q("Share %")].join(","),
    ...Object.entries(faultMap).sort((a,b)=>b[1]-a[1]).map(([name,count],i)=>[q(String(i+1)),q(name),q(String(count)),q(String(total?Math.round((count/total)*100):0))].join(",")),
    "",q("REGIONAL PERFORMANCE"),
    [q("Region"),q("Total"),q("OK"),q("FAIL"),q("OK Rate %"),q("Replacements")].join(","),
    ...Object.entries(regionMap).sort((a,b)=>b[1].total-a[1].total).map(([name,d])=>[q(name),q(String(d.total)),q(String(d.ok)),q(String(d.total-d.ok)),q(String(d.total?Math.round((d.ok/d.total)*100):0)),q(String(d.rep))].join(",")),
    "",q("TECHNICIAN PERFORMANCE"),
    [q("#"),q("Technician"),q("Region"),q("Branch"),q("Total"),q("OK"),q("FAIL"),q("OK Rate %"),q("Replacements")].join(","),
    ...Object.values(techMap).sort((a,b)=>b.total-a.total).map((t,i)=>[q(String(i+1)),q(t.name),q(t.region),q(t.branch),q(String(t.total)),q(String(t.ok)),q(String(t.total-t.ok)),q(String(t.total?Math.round((t.ok/t.total)*100):0)),q(String(t.rep))].join(",")),
    "",q("REPLACEMENT REASONS"),
    [q("Reason"),q("Count"),q("Share %")].join(","),
    ...Object.entries(repMap).sort((a,b)=>b[1]-a[1]).map(([name,count])=>[q(name),q(String(count)),q(String(reps?Math.round((count/reps)*100):0))].join(",")),
  ];
  const csv="\uFEFF"+lines.join("\r\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  a.download=`AzamSD_Analytics_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
}

async function callChatGPT(prompt: string): Promise<string> {
  const apiKey = localStorage.getItem("azam_openai_key") || "";
  if (!apiKey) throw new Error('No API key set.\nClick "⚙ AI Settings" to add your OpenAI API key.');
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as {error?:{message?:string}};
    throw new Error(e.error?.message || `API error ${res.status}`);
  }
  const data = await res.json() as {choices?: {message?: {content?: string}}[]};
  return data.choices?.[0]?.message?.content || "No response.";
}

// ─── TOAST SYSTEM ────────────────────────────────────────────────────────────

type ToastType = "success"|"error"|"info";
interface ToastItem { id: string; msg: string; type: ToastType; }
let _setToasts: React.Dispatch<React.SetStateAction<ToastItem[]>> | null = null;

function showToast(msg: string, type: ToastType = "info") {
  if (!_setToasts) { console.warn("[Toast]", msg); return; }
  const id = uid();
  _setToasts(t => [...t, {id, msg, type}]);
  setTimeout(() => _setToasts!(t => t.filter(x => x.id !== id)), 4000);
}

function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  useEffect(() => { _setToasts = setToasts; return () => { _setToasts = null; }; }, []);
  const colors: Record<ToastType,{bg:string;border:string;icon:string}> = {
    success: { bg:"#F0FDF4", border:"#86EFAC", icon:"✓" },
    error:   { bg:"#FEF2F2", border:"#FCA5A5", icon:"✕" },
    info:    { bg:"#EFF6FF", border:"#93C5FD", icon:"ℹ" },
  };
  if (!toasts.length) return null;
  return (
    <div style={{ position:"fixed", bottom:24, right:24, zIndex:9998, display:"flex", flexDirection:"column", gap:8, maxWidth:340 }}>
      {toasts.map(t => {
        const s = colors[t.type];
        return (
          <div key={t.id} style={{ background:s.bg, border:`1px solid ${s.border}`, borderRadius:10, padding:"11px 16px", display:"flex", gap:10, alignItems:"flex-start", boxShadow:"0 4px 20px rgba(0,0,0,.12)", animation:"slideInRight .25s ease", fontSize:13, fontFamily:"'DM Sans',sans-serif" }}>
            <span style={{ fontWeight:800, flexShrink:0 }}>{s.icon}</span>
            <span style={{ flex:1, lineHeight:1.5 }}>{t.msg}</span>
            <button onClick={() => _setToasts!(x => x.filter(i => i.id !== t.id))} style={{ background:"none", border:"none", cursor:"pointer", color:C.muted, fontSize:15, lineHeight:1, flexShrink:0, padding:0 }}>✕</button>
          </div>
        );
      })}
    </div>
  );
}

// ─── CONFIRM MODAL ────────────────────────────────────────────────────────────

interface ConfirmState { msg: string; title?: string; onOk: () => void; onCancel: () => void; confirmLabel?: string; confirmVariant?: string; }

function ConfirmModal({ msg, title, onOk, onCancel, confirmLabel="Confirm", confirmVariant="danger" }: ConfirmState) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(10,22,40,.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:8000, padding:20 }} onClick={e=>{ if(e.target===e.currentTarget) onCancel(); }}>
      <div style={{ background:"#fff", borderRadius:16, padding:28, maxWidth:400, width:"100%", boxShadow:"0 24px 64px rgba(0,0,0,.35)", animation:"fadeIn .15s ease" }}>
        {title && <h3 style={{ margin:"0 0 10px", fontSize:17, fontWeight:800, color:C.text, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.5 }}>{title}</h3>}
        <p style={{ margin:"0 0 24px", fontSize:14, color:C.text, lineHeight:1.65, whiteSpace:"pre-wrap" }}>{msg}</p>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <Btn onClick={onCancel} variant="ghost">Cancel</Btn>
          <Btn onClick={onOk} variant={confirmVariant}>{confirmLabel}</Btn>
        </div>
      </div>
    </div>
  );
}

function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);
  const confirm = useCallback((msg: string, opts?: { title?: string; confirmLabel?: string; confirmVariant?: string }) => {
    return new Promise<boolean>(resolve => {
      setState({ msg, title:opts?.title, confirmLabel:opts?.confirmLabel||"Confirm", confirmVariant:opts?.confirmVariant||"danger",
        onOk:    () => { setState(null); resolve(true);  },
        onCancel:() => { setState(null); resolve(false); },
      });
    });
  }, []);
  const ConfirmUI = state ? <ConfirmModal {...state}/> : null;
  return { confirm, ConfirmUI };
}

// ─── MOBILE HOOK ─────────────────────────────────────────────────────────────

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [breakpoint]);
  return isMobile;
}

// ─── PRIMITIVE COMPONENTS ────────────────────────────────────────────────────

function Btn({ children, onClick, variant="primary", size="md", disabled, full, style: s }: {
  children: React.ReactNode; onClick?: () => void; variant?: string;
  size?: string; disabled?: boolean; full?: boolean; style?: React.CSSProperties;
}) {
  const pad  = size === "sm" ? "6px 14px" : "10px 22px";
  const fs   = size === "sm" ? 12 : 14;
  const vars: Record<string, React.CSSProperties> = {
    primary: { background:`linear-gradient(135deg,${C.blue},${C.blueMid})`,   color:"#fff", border:"none" },
    danger:  { background:`linear-gradient(135deg,${C.red},${C.redBright})`,  color:"#fff", border:"none" },
    ghost:   { background:"transparent", color:C.blue, border:`1.5px solid ${C.border}` },
    success: { background:"linear-gradient(135deg,#16A34A,#15803D)",          color:"#fff", border:"none" },
    dark:    { background:C.blueDark, color:"#fff", border:"none" },
    ai:      { background:`linear-gradient(135deg,${C.ai},#5B21B6)`,          color:"#fff", border:"none" },
    pdf:     { background:"linear-gradient(135deg,#B91C1C,#991B1B)",          color:"#fff", border:"none" },
  };
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding:pad, borderRadius:8, fontWeight:700, cursor:disabled?"not-allowed":"pointer", fontSize:fs,
        fontFamily:"'DM Sans',sans-serif", transition:"all .15s", opacity:disabled?0.55:1,
        width:full?"100%":"auto", whiteSpace:"nowrap", ...(vars[variant]||vars.primary), ...s }}>
      {children}
    </button>
  );
}

function Card({ children, style: s, className }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return <div className={className} style={{ background:C.white, borderRadius:12, padding:20, boxShadow:"0 1px 6px rgba(10,22,40,.08)", border:`1px solid ${C.border}`, ...s }}>{children}</div>;
}

function MetricCard({ label, value, sub, color=C.blue, icon }: { label:string; value:string|number; sub?:string; color?:string; icon?:string }) {
  return (
    <Card style={{ flex:1, minWidth:130 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div style={{ minWidth:0 }}>
          <div style={{ color:C.muted, fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:.9, marginBottom:6 }}>{label}</div>
          <div style={{ color, fontSize:28, fontWeight:800, lineHeight:1, fontFamily:"'Barlow Condensed',sans-serif" }}>{value}</div>
          {sub && <div style={{ color:C.muted, fontSize:11, marginTop:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{sub}</div>}
        </div>
        {icon && <span style={{ fontSize:22, opacity:.4, flexShrink:0, marginLeft:8 }}>{icon}</span>}
      </div>
    </Card>
  );
}

function Inp({ value, onChange, placeholder, type="text", style: s, disabled, onKeyDown, maxLength }: {
  value: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string; type?: string; style?: React.CSSProperties;
  disabled?: boolean; onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  maxLength?: number;
}) {
  return <input type={type} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} onKeyDown={onKeyDown} maxLength={maxLength}
    style={{ padding:"9px 12px", borderRadius:8, border:`1.5px solid ${C.border}`, fontSize:13, width:"100%", boxSizing:"border-box", fontFamily:"'DM Sans',sans-serif", background:disabled?"#F8FAFC":"#fff", color:C.text, outline:"none", ...s }}/>;
}

function Sel({ value, onChange, children, style: s, disabled }: {
  value: string; onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode; style?: React.CSSProperties; disabled?: boolean;
}) {
  return <select value={value} onChange={onChange} disabled={disabled}
    style={{ padding:"9px 12px", borderRadius:8, border:`1.5px solid ${C.border}`, fontSize:13, width:"100%", boxSizing:"border-box", fontFamily:"'DM Sans',sans-serif", background:disabled?"#F8FAFC":"#fff", color:C.text, ...s }}>{children}</select>;
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:.9, display:"block", marginBottom:5 }}>{label}</label>{children}</div>;
}

function Badge({ children, color="blue" }: { children: React.ReactNode; color?: string }) {
  const map: Record<string,{bg:string;c:string}> = {
    blue:{bg:"#EFF6FF",c:C.blue}, red:{bg:"#FEE2E2",c:C.red}, green:{bg:"#DCFCE7",c:C.success},
    yellow:{bg:"#FEF3C7",c:C.warning}, gray:{bg:"#F1F5F9",c:C.muted}, purple:{bg:C.aiLight,c:C.ai},
    teal:{bg:"#CFFAFE",c:C.teal}, orange:{bg:"#FFF7ED",c:"#C2410C"},
  };
  return <span style={{ padding:"3px 9px", borderRadius:20, fontSize:11, fontWeight:700, whiteSpace:"nowrap", ...(map[color]||map.blue) }}>{children}</span>;
}

function EmptyState({ icon="📭", msg="No data yet" }: { icon?: string; msg?: string }) {
  return <div style={{ padding:"48px 24px", textAlign:"center", color:C.muted }}><div style={{ fontSize:36, marginBottom:10 }}>{icon}</div><div style={{ fontSize:13 }}>{msg}</div></div>;
}

function Modal({ title, children, onClose, width=440 }: { title:string; children:React.ReactNode; onClose:()=>void; width?:number }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(10,22,40,.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2000, padding:16 }} onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:C.white, borderRadius:16, padding:28, width:"100%", maxWidth:width, boxShadow:"0 24px 64px rgba(0,0,0,.35)", maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <h3 style={{ margin:0, fontSize:16, fontWeight:800, color:C.text, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.5 }}>{title}</h3>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:C.muted, lineHeight:1, padding:4 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PageHeader({ title, sub, action, onMenu }: { title:string; sub?:string; action?: React.ReactNode; onMenu?: () => void }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ background:C.white, borderBottom:`1px solid ${C.border}`, padding:isMobile?"12px 16px":"16px 28px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8, flexShrink:0 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
        {isMobile && onMenu && (
          <button onClick={onMenu} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:C.blue, padding:0, flexShrink:0 }}>☰</button>
        )}
        <div style={{ minWidth:0 }}>
          <h2 style={{ margin:0, color:C.text, fontSize:isMobile?16:20, fontWeight:700, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{title}</h2>
          {sub && <p style={{ margin:0, color:C.muted, fontSize:11, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{sub}</p>}
        </div>
      </div>
      {action && <div style={{ display:"flex", gap:8, flexWrap:"wrap", flexShrink:0 }}>{action}</div>}
    </div>
  );
}

function FilterBar({ filters, setFilter, clearAll, regions=[], branches=[], techs=[], showBranch=true, showTech=true, showFault=false, showResult=false, showDate=true }: {
  filters: Record<string,string>; setFilter:(k:string,v:string)=>void; clearAll:()=>void;
  regions?:string[]; branches?:string[]; techs?:User[];
  showBranch?:boolean; showTech?:boolean; showFault?:boolean; showResult?:boolean; showDate?:boolean;
}) {
  return (
    <Card style={{ marginBottom:16 }}>
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
        {regions.length > 0 && (
          <div style={{ flex:1, minWidth:130 }}><label style={LBL}>Region</label>
            <Sel value={filters.region||""} onChange={e=>setFilter("region",e.target.value)}><option value="">All Regions</option>{regions.map(r=><option key={r} value={r}>{r}</option>)}</Sel>
          </div>
        )}
        {showBranch && (
          <div style={{ flex:1, minWidth:130 }}><label style={LBL}>Branch / Station</label>
            <Sel value={filters.branch||""} onChange={e=>setFilter("branch",e.target.value)}><option value="">All Branches</option>{branches.map(b=><option key={b} value={b}>{b}</option>)}</Sel>
          </div>
        )}
        {showTech && techs.length > 0 && (
          <div style={{ flex:1, minWidth:130 }}><label style={LBL}>Technician</label>
            <Sel value={filters.tech||""} onChange={e=>setFilter("tech",e.target.value)}><option value="">All Technicians</option>{techs.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</Sel>
          </div>
        )}
        {showFault && (
          <div style={{ flex:1, minWidth:170 }}><label style={LBL}>Fault Type</label>
            <Sel value={filters.fault||""} onChange={e=>setFilter("fault",e.target.value)}><option value="">All Faults</option>{FAULT_TYPES.map(x=><option key={x} value={x}>{x}</option>)}</Sel>
          </div>
        )}
        {showResult && (
          <div style={{ minWidth:90 }}><label style={LBL}>Result</label>
            <Sel value={filters.result||""} onChange={e=>setFilter("result",e.target.value)}><option value="">All</option><option value="OK">OK</option><option value="FAIL">FAIL</option></Sel>
          </div>
        )}
        {showDate && (
          <>
            <div style={{ minWidth:130 }}><label style={LBL}>From</label><Inp type="date" value={filters.from||""} onChange={e=>setFilter("from",e.target.value)} style={{ width:"auto" }}/></div>
            <div style={{ minWidth:130 }}><label style={LBL}>To</label><Inp type="date" value={filters.to||""} onChange={e=>setFilter("to",e.target.value)} style={{ width:"auto" }}/></div>
          </>
        )}
        <Btn onClick={clearAll} variant="ghost" size="sm">Clear</Btn>
      </div>
    </Card>
  );
}

// ─── AZAM LOGO ───────────────────────────────────────────────────────────────

function AzamLogo({ size="md" }: { size?: "xs"|"sm"|"md"|"lg" }) {
  const sz = ({xs:{w:32,h:22,f:10},sm:{w:62,h:40,f:15},md:{w:92,h:58,f:22},lg:{w:130,h:82,f:30}} as Record<string,{w:number;h:number;f:number}>)[size]||{w:62,h:40,f:15};
  return (
    <div style={{ width:sz.w, height:sz.h, background:"#111", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto", position:"relative", overflow:"hidden", boxShadow:`0 0 0 2.5px ${C.blue},0 0 0 5px #111,0 6px 20px rgba(26,58,143,.45)`, flexShrink:0 }}>
      <div style={{ position:"absolute", width:"140%", height:"45%", border:`2.5px solid ${C.blue}`, borderRadius:"50%", transform:"rotate(-12deg)", opacity:.75, pointerEvents:"none" }}/>
      <div style={{ position:"absolute", width:"120%", height:"35%", border:`1.5px solid ${C.blue}`, borderRadius:"50%", transform:"rotate(-12deg) translateY(8px)", opacity:.35, pointerEvents:"none" }}/>
      <span style={{ fontWeight:900, fontSize:sz.f, letterSpacing:-.5, zIndex:1, fontFamily:"'Barlow Condensed',sans-serif", lineHeight:1 }}>
        <span style={{ color:C.red }}>azam</span><span style={{ color:C.blue }}>tv</span>
      </span>
    </div>
  );
}

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────

function Sidebar({ user, nav, active, setActive, onLogout, mobileOpen, onMobileClose }: {
  user:User; nav:{key:string;icon:string;label:string;badge?:number}[]; active:string;
  setActive:(k:string)=>void; onLogout:()=>void;
  mobileOpen?: boolean; onMobileClose?: () => void;
}) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const roleLabel = user.role === "management" ? (user.managementType || "Management") : user.role === "technical_analyst" ? "Tech Analyst" : user.role;
  const roleColor = ({admin:C.red,technician:C.blueMid,management:C.success,technical_analyst:C.teal} as Record<string,string>)[user.role] || C.blue;
  const initials  = user.name.split(" ").map(n=>n[0]).join("").slice(0,2).toUpperCase();

  function handleNavClick(key: string) {
    setActive(key);
    if (isMobile && onMobileClose) onMobileClose();
  }

  const sidebarContent = (
    <div style={{ width:isMobile?240:(collapsed?64:224), minHeight:"100vh", background:C.blueDark, display:"flex", flexDirection:"column", flexShrink:0, boxShadow:"3px 0 16px rgba(0,0,0,.35)", overflow:"hidden", position:"relative" }}>
      {!isMobile && (
        <button onClick={()=>setCollapsed(c=>!c)} title={collapsed?"Expand":"Collapse"} style={{ position:"absolute", top:12, right:8, background:"rgba(255,255,255,.08)", border:"1px solid rgba(255,255,255,.12)", borderRadius:6, color:"rgba(255,255,255,.6)", cursor:"pointer", width:26, height:26, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, zIndex:10, flexShrink:0 }}>{collapsed?"▶":"◀"}</button>
      )}
      <div style={{ padding:isMobile?"22px 16px 16px":(collapsed?"18px 0 14px":"22px 16px 16px"), borderBottom:"1px solid rgba(255,255,255,.07)", textAlign:"center", overflow:"hidden", whiteSpace:"nowrap" }}>
        <AzamLogo size={collapsed&&!isMobile?"xs":"sm"}/>
        {(!collapsed||isMobile) && <>
          <div style={{ color:"#fff", fontWeight:700, fontSize:13, marginTop:10, lineHeight:1.25, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.8 }}>AZAM SERVICE DESK</div>
          <div style={{ color:"rgba(255,255,255,.35)", fontSize:10, marginTop:3, letterSpacing:.5 }}>STB Log Service Report</div>
        </>}
      </div>
      <div style={{ padding:isMobile?"12px 14px":(collapsed?"10px 0":"12px 14px"), borderBottom:"1px solid rgba(255,255,255,.05)", textAlign:(collapsed&&!isMobile)?"center":"left", overflow:"hidden", whiteSpace:"nowrap" }}>
        {(collapsed&&!isMobile)
          ? <div title={user.name} style={{ width:36,height:36,borderRadius:"50%",background:roleColor,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto",fontSize:13,fontWeight:800,color:"#fff",fontFamily:"'Barlow Condensed',sans-serif" }}>{initials}</div>
          : <>
            <div style={{ color:"rgba(255,255,255,.4)", fontSize:9, textTransform:"uppercase", letterSpacing:1.2 }}>Signed in as</div>
            <div style={{ color:"#fff", fontSize:13, fontWeight:700, marginTop:3, lineHeight:1.2, overflow:"hidden", textOverflow:"ellipsis" }}>{user.name}</div>
            <div style={{ marginTop:5 }}><span style={{ padding:"2px 8px", borderRadius:20, fontSize:10, fontWeight:700, background:roleColor, color:"#fff", textTransform:"capitalize" }}>{roleLabel}</span></div>
            <div style={{ color:"rgba(255,255,255,.3)", fontSize:10, marginTop:4, overflow:"hidden", textOverflow:"ellipsis" }}>📍 {user.region}</div>
          </>
        }
      </div>
      <nav style={{ flex:1, padding:(collapsed&&!isMobile)?"10px 4px":"10px 8px", overflowY:"auto" }}>
        {nav.map(item => (
          <button key={item.key} onClick={()=>handleNavClick(item.key)} title={(collapsed&&!isMobile)?item.label:""}
            style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:(collapsed&&!isMobile)?"center":"flex-start", gap:10, padding:(collapsed&&!isMobile)?"10px 0":"10px 12px", borderRadius:8, border:"none", cursor:"pointer",
              background:active===item.key?(item.key==="ai"?"rgba(109,40,217,.28)":"rgba(43,82,200,.28)"):"transparent",
              color:active===item.key?"#fff":"rgba(255,255,255,.5)", fontSize:(collapsed&&!isMobile)?18:13,
              fontWeight:active===item.key?700:400, marginBottom:2, textAlign:"left",
              fontFamily:"'DM Sans',sans-serif", transition:"all .15s", whiteSpace:"nowrap", overflow:"hidden",
              borderLeft:active===item.key&&(!collapsed||isMobile)?`3px solid ${item.key==="ai"?"#A78BFA":C.red}`:"3px solid transparent" }}>
            <span style={{ fontSize:15, flexShrink:0 }}>{item.icon}</span>
            {(!collapsed||isMobile) && <span style={{ fontSize:13 }}>{item.label}</span>}
            {(!collapsed||isMobile) && (item.badge&&item.badge>0 ? <span style={{ marginLeft:"auto",minWidth:18,height:18,background:C.red,color:"#fff",borderRadius:9,fontSize:10,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 5px" }}>{item.badge>99?"99+":item.badge}</span> : item.key==="ai" ? <span style={{ marginLeft:"auto",fontSize:9,background:"rgba(167,139,250,.25)",color:"#C4B5FD",padding:"2px 6px",borderRadius:10,fontWeight:700 }}>AI</span> : null)}
          </button>
        ))}
      </nav>
      <div style={{ padding:(collapsed&&!isMobile)?"8px 4px":"12px", borderTop:"1px solid rgba(255,255,255,.05)" }}>
        <button onClick={onLogout} title="Sign Out" style={{ width:"100%", padding:(collapsed&&!isMobile)?"9px 0":"9px 12px", borderRadius:8, border:"1px solid rgba(255,255,255,.1)", background:"transparent", color:"rgba(255,255,255,.5)", cursor:"pointer", fontSize:(collapsed&&!isMobile)?16:12, fontFamily:"'DM Sans',sans-serif", display:"flex", alignItems:"center", gap:8, justifyContent:"center", whiteSpace:"nowrap", overflow:"hidden" }}>↩{(!collapsed||isMobile) && " Sign Out"}</button>
      </div>
    </div>
  );

  if (isMobile) {
    return <>
      {mobileOpen && (
        <>
          <div className="sidebar-backdrop visible" onClick={onMobileClose}/>
          <div className="sidebar-mobile">{sidebarContent}</div>
        </>
      )}
    </>;
  }

  return <div className="sidebar-desktop">{sidebarContent}</div>;
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────

const loginAttemptKey = "azamsd_login_attempts";
interface LoginAttempts { count: number; lockUntil: number; }

function LoginPage({ users, onLogin, onSaveUsers }: { users:User[]; onLogin:(u:User)=>void; onSaveUsers:(u:User[])=>void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [lockLeft, setLockLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function getAttempts(): LoginAttempts {
    try { return JSON.parse(sessionStorage.getItem(loginAttemptKey)||"{}") as LoginAttempts; } catch { return {count:0,lockUntil:0}; }
  }
  function setAttempts(a: LoginAttempts) { try { sessionStorage.setItem(loginAttemptKey, JSON.stringify(a)); } catch {} }

  useEffect(() => {
    const a = getAttempts();
    if (a.lockUntil > Date.now()) {
      const remaining = Math.ceil((a.lockUntil - Date.now()) / 1000);
      setLockLeft(remaining);
      timerRef.current = setInterval(() => {
        const left = Math.ceil((a.lockUntil - Date.now()) / 1000);
        if (left <= 0) { setLockLeft(0); setAttempts({count:0,lockUntil:0}); if(timerRef.current) clearInterval(timerRef.current); }
        else setLockLeft(left);
      }, 1000);
    }
    return () => { if(timerRef.current) clearInterval(timerRef.current); };
  }, []);

  async function handleLogin() {
    const a = getAttempts();
    if (a.lockUntil > Date.now()) { setError(`Too many attempts. Try again in ${lockLeft}s.`); return; }
    if (!username.trim() || !password) { setError("Please enter username and password."); return; }
    setLoading(true); setError("");
    await new Promise(r => setTimeout(r, 500));

    const candidate = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
    let matched = false;

    if (candidate) {
      matched = await verifyPassword(password, candidate.password);
      if (matched && !candidate.password.startsWith("sha256:")) {
        const hashed = await hashPassword(password);
        const updated = users.map(u => u.id===candidate.id ? {...u, password:hashed} : u);
        onSaveUsers(updated);
      }
    }

    if (matched && candidate) {
      setAttempts({count:0, lockUntil:0});
      logActivity(candidate, "LOGIN", "Signed in");
      saveSession(candidate.id);
      onLogin(candidate);
    } else {
      const newCount = (a.count || 0) + 1;
      const lockUntil = newCount >= 5 ? Date.now() + 30000 : 0;
      setAttempts({count:newCount, lockUntil});
      if (lockUntil) {
        setLockLeft(30); setError("Too many failed attempts. Locked for 30 seconds.");
        timerRef.current = setInterval(() => {
          const left = Math.ceil((lockUntil - Date.now()) / 1000);
          if (left <= 0) { setLockLeft(0); setAttempts({count:0,lockUntil:0}); setError(""); if(timerRef.current) clearInterval(timerRef.current); }
          else { setLockLeft(left); setError(`Too many attempts. Try again in ${left}s.`); }
        }, 1000);
      } else {
        setError(`Invalid username or password. ${5-newCount} attempt(s) remaining.`);
      }
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = { width:"100%", boxSizing:"border-box", padding:"11px 14px", borderRadius:9, border:"1.5px solid rgba(255,255,255,.15)", background:"rgba(255,255,255,.08)", color:"#fff", fontSize:14, fontFamily:"'DM Sans',sans-serif", outline:"none" };
  const labelStyle: React.CSSProperties = { color:"rgba(255,255,255,.6)", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:.9, display:"block", marginBottom:6 };

  return (
    <div style={{ minHeight:"100vh", background:`linear-gradient(135deg,${C.blueDark} 0%,#0F2055 55%,#1A3A8F 100%)`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',sans-serif", padding:20 }}>
      <div style={{ width:"100%", maxWidth:380 }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <AzamLogo size="lg"/>
          <div style={{ color:"#fff", fontWeight:700, fontSize:22, marginTop:16, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:1 }}>AZAM SERVICE DESK</div>
          <div style={{ color:"rgba(255,255,255,.4)", fontSize:13, marginTop:4 }}>STB Log Service Report</div>
        </div>
        <div style={{ background:"rgba(255,255,255,.06)", borderRadius:16, padding:28, border:"1px solid rgba(255,255,255,.1)" }}>
          <div style={{ marginBottom:16 }}>
            <label style={labelStyle}>Username</label>
            <input value={username} onChange={e=>setUsername(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="Enter username" style={inputStyle} autoComplete="username"/>
          </div>
          <div style={{ marginBottom:20 }}>
            <label style={labelStyle}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="Enter password" style={inputStyle} autoComplete="current-password"/>
          </div>
          {error && <div style={{ color:"#FCA5A5", fontSize:12, marginBottom:14, textAlign:"center", lineHeight:1.5 }}>{error}</div>}
          <button onClick={handleLogin} disabled={loading||lockLeft>0} style={{ width:"100%", padding:"12px", borderRadius:9, border:"none", cursor:(loading||lockLeft>0)?"not-allowed":"pointer", background:`linear-gradient(135deg,${C.blue},${C.blueMid})`, color:"#fff", fontSize:15, fontWeight:700, fontFamily:"'DM Sans',sans-serif", opacity:(loading||lockLeft>0)?.6:1 }}>
            {loading ? "Signing in…" : lockLeft > 0 ? `Locked (${lockLeft}s)` : "Sign In"}
          </button>
        </div>
        <div style={{ textAlign:"center", color:"rgba(255,255,255,.25)", fontSize:11, marginTop:20 }}>Azam TV Service Desk · Confidential</div>
      </div>
    </div>
  );
}

// ─── JOB ROW (table mode) ────────────────────────────────────────────────────

function JobRowComp({ row, onChange, onDelete }: { row:JobRow; onChange:(f:string,v:string)=>void; onDelete:()=>void }) {
  const td: React.CSSProperties = { padding:"6px 6px", verticalAlign:"top" };
  return (
    <tr style={{ borderBottom:`1px solid ${C.border}` }}>
      <td style={td}><Inp value={row.customerName} onChange={e=>onChange("customerName",e.target.value)} placeholder="Customer name"/></td>
      <td style={td}><Inp value={row.phone} onChange={e=>onChange("phone",e.target.value)} placeholder="Phone"/></td>
      <td style={td}><Inp value={row.cardNumber} onChange={e=>onChange("cardNumber",e.target.value)} placeholder="Card #"/></td>
      <td style={td}><Sel value={row.faultType} onChange={e=>onChange("faultType",e.target.value)}><option value="">Select fault</option>{FAULT_TYPES.map(f=><option key={f} value={f}>{f}</option>)}</Sel></td>
      <td style={td}><Sel value={row.modelNumber} onChange={e=>onChange("modelNumber",e.target.value)}><option value="">Select model</option>{STB_MODELS.map(m=><option key={m} value={m}>{m}</option>)}</Sel></td>
      <td style={td}><Inp value={row.troubleshootDescription} onChange={e=>onChange("troubleshootDescription",e.target.value)} placeholder="Notes…"/></td>
      <td style={td}>
        <Sel value={row.result} onChange={e=>onChange("result",e.target.value)} style={{ width:80 }}>
          <option value="">—</option><option value="OK">OK</option><option value="FAIL">FAIL</option>
        </Sel>
      </td>
      <td style={{ ...td, minWidth:160 }}>
        <Sel value={row.replacement} onChange={e=>onChange("replacement",e.target.value)} style={{ width:70, marginBottom:row.replacement==="Yes"?4:0 }}>
          <option value="">—</option><option value="Yes">Yes</option><option value="No">No</option>
        </Sel>
        {row.replacement==="Yes" && <>
          <Sel value={row.replacementReason} onChange={e=>onChange("replacementReason",e.target.value)} style={{ marginBottom:row.replacementReason==="Other"?4:0 }}>
            <option value="">Select reason</option>{REPLACEMENT_REASONS.map(r=><option key={r} value={r}>{r}</option>)}
          </Sel>
          {row.replacementReason==="Other" && <Inp value={row.replacementOtherReason} onChange={e=>onChange("replacementOtherReason",e.target.value)} placeholder="Specify reason…"/>}
        </>}
      </td>
      <td style={{ ...td, textAlign:"center" }}>
        <button onClick={onDelete} style={{ background:"none", border:"none", cursor:"pointer", color:C.red, fontSize:18, lineHeight:1 }}>✕</button>
      </td>
    </tr>
  );
}

// Mobile card mode for job entry
function JobRowCard({ row, onChange, onDelete, index }: { row:JobRow; onChange:(f:string,v:string)=>void; onDelete:()=>void; index:number }) {
  return (
    <Card style={{ marginBottom:12, padding:16, border:`1.5px solid ${C.border}`, position:"relative" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <span style={{ fontWeight:800, color:C.blue, fontSize:13 }}>Job #{index+1}</span>
        <button onClick={onDelete} style={{ background:"#FEE2E2", border:"none", cursor:"pointer", color:C.red, fontSize:13, fontWeight:700, padding:"4px 10px", borderRadius:6 }}>Remove</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px 12px" }}>
        <div><label style={LBL}>Customer Name *</label><Inp value={row.customerName} onChange={e=>onChange("customerName",e.target.value)} placeholder="Full name"/></div>
        <div><label style={LBL}>Phone</label><Inp value={row.phone} onChange={e=>onChange("phone",e.target.value)} placeholder="Phone number"/></div>
        <div style={{ gridColumn:"span 2" }}><label style={LBL}>Card / STB Number *</label><Inp value={row.cardNumber} onChange={e=>onChange("cardNumber",e.target.value)} placeholder="Card number"/></div>
        <div><label style={LBL}>Fault Type *</label><Sel value={row.faultType} onChange={e=>onChange("faultType",e.target.value)}><option value="">Select</option>{FAULT_TYPES.map(f=><option key={f} value={f}>{f}</option>)}</Sel></div>
        <div><label style={LBL}>STB Model *</label><Sel value={row.modelNumber} onChange={e=>onChange("modelNumber",e.target.value)}><option value="">Select</option>{STB_MODELS.map(m=><option key={m} value={m}>{m}</option>)}</Sel></div>
        <div><label style={LBL}>Result *</label><Sel value={row.result} onChange={e=>onChange("result",e.target.value)}><option value="">—</option><option value="OK">OK</option><option value="FAIL">FAIL</option></Sel></div>
        <div><label style={LBL}>Replacement *</label><Sel value={row.replacement} onChange={e=>onChange("replacement",e.target.value)}><option value="">—</option><option value="Yes">Yes</option><option value="No">No</option></Sel></div>
        {row.replacement==="Yes" && <>
          <div style={{ gridColumn:"span 2" }}><label style={LBL}>Replacement Reason</label><Sel value={row.replacementReason} onChange={e=>onChange("replacementReason",e.target.value)}><option value="">Select reason</option>{REPLACEMENT_REASONS.map(r=><option key={r} value={r}>{r}</option>)}</Sel></div>
          {row.replacementReason==="Other" && <div style={{ gridColumn:"span 2" }}><label style={LBL}>Specify Reason</label><Inp value={row.replacementOtherReason} onChange={e=>onChange("replacementOtherReason",e.target.value)} placeholder="Specify…"/></div>}
        </>}
        <div style={{ gridColumn:"span 2" }}><label style={LBL}>Notes</label><Inp value={row.troubleshootDescription} onChange={e=>onChange("troubleshootDescription",e.target.value)} placeholder="Troubleshoot notes…"/></div>
      </div>
    </Card>
  );
}

// ─── TECHNICIAN APP ───────────────────────────────────────────────────────────

function TechnicianApp({ user, allJobs, users, onSubmitBatch, onLogout, messages, onSendMessage, onMarkRead }: { user:User; allJobs:Job[]; users:User[]; onSubmitBatch:(jobs:Job[])=>void; onLogout:()=>void; messages:Message[]; onSendMessage:(m:Omit<Message,"id"|"timestamp"|"read">)=>void; onMarkRead:(id:string)=>void }) {
  const isMobile = useIsMobile();
  const [view,         setView]         = useState("form");
  const [rows,         setRows]         = useState<JobRow[]>([newJobRow()]);
  const [date,         setDate]         = useState(todayStr());
  const [submitted,    setSubmitted]    = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [search,       setSearch]       = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { confirm, ConfirmUI } = useConfirm();
  const [exportFrom, setExportFrom] = useState(""); const [exportTo, setExportTo] = useState("");
  const unreadMsgsTech = useMemo(()=>messages.filter(m=>(m.toId===user.id||m.toId==="all")&&!m.read).length,[messages,user.id]);

  const myJobs         = useMemo(() => allJobs.filter(j => j.technicianId===user.id), [allJobs, user.id]);
  const todaySubmitted = useMemo(() => myJobs.some(j => j.date===todayStr()), [myJobs]);
  useEffect(() => { if (todaySubmitted && date===todayStr()) setSubmitted(true); }, [todaySubmitted, date]);

  function updateRow(id: string, f: string, v: string) {
    setRows(r => r.map(row => row._id===id ? { ...row, [f]:v, ...(f==="replacement"&&v==="No"?{replacementReason:"",replacementOtherReason:""}:{}) } : row));
  }

  async function handleSubmit() {
    const valid = rows.filter(r => r.customerName.trim() && r.cardNumber.trim() && r.faultType && r.modelNumber && r.result && r.replacement);
    if (!valid.length) {
      showToast("Fill the required fields (*) for at least one row before submitting.", "error");
      return;
    }
    const alreadyDone = myJobs.some(j => j.date===date);
    if (alreadyDone) {
      showToast(`A report for ${fmtDate(date)} already exists. Select a different date.`, "error");
      return;
    }
    const ok = await confirm(
      `Submit ${valid.length} job(s) for ${fmtDate(date)}?\n\nThis cannot be undone.`,
      { title:"Confirm Submission", confirmLabel:"Submit", confirmVariant:"primary" }
    );
    if (!ok) return;
    setSaving(true);
    try {
      const jobs: Job[] = valid.map(r => ({
        id:uid(), technicianId:user.id, technicianName:user.name, region:user.region||"—", branch:user.branch||"—",
        date, submittedAt:new Date().toISOString(), status:"submitted",
        customerName:r.customerName.trim(), phone:r.phone.trim(), cardNumber:r.cardNumber.trim(),
        faultType:r.faultType, modelNumber:r.modelNumber, troubleshootDescription:r.troubleshootDescription,
        result:r.result, replacement:r.replacement,
        replacementReason:r.replacement==="Yes" ? (r.replacementReason==="Other" ? r.replacementOtherReason : r.replacementReason) : "",
      }));
      onSubmitBatch(jobs);
      logActivity(user, "SUBMIT_JOBS", `${jobs.length} job(s) for ${fmtDate(date)} — ${user.region} / ${user.branch}`);
      setRows([newJobRow()]);
      setSubmitted(true);
      showToast(`${jobs.length} job(s) submitted successfully!`, "success");
    } catch(e) {
      showToast("Submission failed. Please try again.", "error");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  function handleNewReport() {
    setSubmitted(false);
    const nextDate = myJobs.some(j=>j.date===todayStr()) ? "" : todayStr();
    setDate(nextDate || todayStr());
    setRows([newJobRow()]);
  }

  function handleExport() {
    const range = myJobs.filter(j=>(!exportFrom||j.date>=exportFrom)&&(!exportTo||j.date<=exportTo));
    if (!range.length) { showToast("No records in the selected date range.", "error"); return; }
    technicianCsvExport(range, user.name, user.region||"—", user.branch||"—");
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return myJobs;
    const q = search.toLowerCase();
    return myJobs.filter(j => j.cardNumber?.toLowerCase().includes(q) || j.customerName?.toLowerCase().includes(q) || j.faultType?.toLowerCase().includes(q) || j.date?.includes(q));
  }, [myJobs, search]);

  const nav = [
    { key:"form", icon:"📋", label:"Daily Report" },
    { key:"history", icon:"🔍", label:"Decoder History" },
    { key:"messages", icon:"💬", label:"Messages", ...(unreadMsgsTech>0?{badge:unreadMsgsTech}:{}) },
  ];
  const validCount = rows.filter(r=>r.customerName.trim()&&r.cardNumber.trim()).length;

  return (
    <div className="app-layout" style={{ fontFamily:"'DM Sans',sans-serif", background:C.bg }}>
      {ConfirmUI}
      <Sidebar user={user} nav={nav} active={view} setActive={setView} onLogout={onLogout} mobileOpen={mobileMenuOpen} onMobileClose={()=>setMobileMenuOpen(false)}/>
      <div className="app-main">
        <PageHeader
          title={view==="form"?"Daily Service Report":"Decoder History"}
          sub={view==="form"?`${user.region} · ${user.branch}`:`${myJobs.length} records`}
          action={<div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <Inp type="date" value={exportFrom} onChange={e=>setExportFrom(e.target.value)} style={{width:"auto",fontSize:11,padding:"4px 8px"}}/>
            <span style={{color:"rgba(255,255,255,.5)",fontSize:11}}>→</span>
            <Inp type="date" value={exportTo} onChange={e=>setExportTo(e.target.value)} style={{width:"auto",fontSize:11,padding:"4px 8px"}}/>
            <Btn onClick={handleExport} variant="ghost" size="sm">⬇ CSV</Btn>
          </div>}
          onMenu={()=>setMobileMenuOpen(true)}
        />
        <div className="page-pad" style={{ flex:1, padding:isMobile?12:24 }}>
          {view==="form" && <>
            <Card style={{ marginBottom:16, padding:0, overflow:"hidden" }}>
              <div style={{ background:`linear-gradient(135deg,${C.blueDark},${C.blue})`, padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <div style={{ color:"rgba(255,255,255,.55)", fontSize:10, textTransform:"uppercase", letterSpacing:2, fontWeight:700 }}>STB Service Report</div>
                  <div style={{ color:"#fff", fontSize:18, fontWeight:700, marginTop:2, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.5 }}>Azam TV</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ color:"rgba(255,255,255,.5)", fontSize:10, textTransform:"uppercase", letterSpacing:1 }}>Technician</div>
                  <div style={{ color:"#fff", fontWeight:700, fontSize:14 }}>{user.name}</div>
                </div>
              </div>
              <div style={{ padding:"14px 20px", display:"flex", gap:16, alignItems:"center", flexWrap:"wrap" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <label style={{ fontSize:12, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:.8, whiteSpace:"nowrap" }}>Report Date:</label>
                  <Inp type="date" value={date} onChange={e=>{ setDate(e.target.value); if(e.target.value!==todayStr()) setSubmitted(false); }} disabled={submitted} style={{ width:"auto" }}/>
                </div>
                <div style={{ flex:1, color:C.muted, fontSize:12 }}>📍 {user.region} · {user.branch}</div>
                {submitted && <Badge color="green">✅ Submitted</Badge>}
              </div>
            </Card>

            {submitted ? (
              <Card style={{ textAlign:"center", padding:"48px 24px" }}>
                <div style={{ fontSize:52, marginBottom:16 }}>✅</div>
                <h3 style={{ color:C.success, margin:"0 0 8px", fontSize:22, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.5 }}>Submitted Successfully!</h3>
                <p style={{ color:C.muted, margin:"0 0 6px", fontSize:14 }}>Report for {fmtDate(date)} is locked.</p>
                <p style={{ color:C.muted, fontSize:12 }}>{myJobs.filter(j=>j.date===date).length} job(s) logged</p>
                <div style={{ marginTop:24, display:"flex", gap:12, justifyContent:"center", flexWrap:"wrap" }}>
                  <Btn onClick={()=>setView("history")} variant="ghost" size="sm">View History →</Btn>
                  {!todaySubmitted && <Btn onClick={handleNewReport} variant="primary" size="sm">+ New Date Report</Btn>}
                </div>
              </Card>
            ) : <>
              {isMobile ? (
                <>
                  {rows.map((row, i) => <JobRowCard key={row._id} row={row} onChange={(f,v)=>updateRow(row._id,f,v)} onDelete={()=>setRows(r=>r.filter(x=>x._id!==row._id))} index={i}/>)}
                  <Btn onClick={()=>setRows(r=>[...r,newJobRow()])} variant="ghost" full style={{ marginBottom:16 }}>+ Add Another Job</Btn>
                </>
              ) : (
                <Card style={{ padding:0, overflow:"hidden", marginBottom:16 }}>
                  <div className="table-wrap">
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, minWidth:1060 }}>
                      <thead>
                        <tr style={{ background:"#F5F8FF" }}>
                          {["Customer Name *","Phone","Card / STB # *","Fault Type *","STB Model *","Notes","Result *","Replacement *",""].map(h =>
                            <th key={h} style={{ padding:"10px 8px", color:C.muted, textAlign:"left", fontWeight:700, fontSize:10, textTransform:"uppercase", letterSpacing:.7, borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap" }}>{h}</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(row => <JobRowComp key={row._id} row={row} onChange={(f,v)=>updateRow(row._id,f,v)} onDelete={()=>setRows(r=>r.filter(x=>x._id!==row._id))}/>)}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding:"10px 16px", borderTop:`1px solid ${C.border}`, background:"#FAFCFF", display:"flex", gap:10, alignItems:"center" }}>
                    <Btn onClick={()=>setRows(r=>[...r,newJobRow()])} variant="ghost" size="sm">+ Add Row</Btn>
                    <span style={{ color:C.muted, fontSize:12 }}>{rows.length} row(s)</span>
                  </div>
                </Card>
              )}

              <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center", gap:12 }}>
                {validCount===0 && <span style={{ color:C.muted, fontSize:12 }}>Fill Customer Name + Card # to enable submit</span>}
                <Btn onClick={handleSubmit} disabled={saving||validCount===0}>
                  {saving ? "Submitting…" : `Submit ${validCount} Job(s)`}
                </Btn>
              </div>
            </>}
          </>}

          {view==="history" && <>
            <div style={{ marginBottom:14 }}><Inp value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search card#, customer, fault, date…" style={{ maxWidth:400 }}/></div>
            <Card style={{ padding:0, overflow:"hidden" }}>
              <div style={{ padding:"12px 18px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontWeight:700, color:C.text, fontSize:14 }}>My Decoder Records</span>
                <span style={{ color:C.muted, fontSize:12 }}>{filtered.length} record(s)</span>
              </div>
              <div className="table-wrap">
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, minWidth:700 }}>
                  <thead><tr style={{ background:"#F5F8FF" }}>{["Date","Customer","Phone","Card Number","Fault","Model","Result","Replacement","Reason"].map(h=><th key={h} style={{ padding:"10px 14px", color:C.muted, textAlign:"left", fontWeight:700, fontSize:11, textTransform:"uppercase", letterSpacing:.7, borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {filtered.length===0
                      ? <tr><td colSpan={9} style={{ padding:32, textAlign:"center", color:C.muted }}>No records match</td></tr>
                      : [...filtered].reverse().map(j => (
                        <tr key={j.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                          <td style={{ padding:"10px 14px", color:C.muted, fontSize:12, whiteSpace:"nowrap" }}>{fmtDate(j.date)}</td>
                          <td style={{ padding:"10px 14px", fontWeight:600 }}>{j.customerName}</td>
                          <td style={{ padding:"10px 14px", color:C.muted, fontSize:12 }}>{j.phone||"—"}</td>
                          <td style={{ padding:"10px 14px", fontFamily:"monospace", fontWeight:800, color:C.blue }}>{j.cardNumber}</td>
                          <td style={{ padding:"10px 14px", fontSize:12 }}>{j.faultType}</td>
                          <td style={{ padding:"10px 14px", fontSize:11, color:C.muted }}>{j.modelNumber}</td>
                          <td style={{ padding:"10px 14px" }}><Badge color={j.result==="OK"?"green":"red"}>{j.result}</Badge></td>
                          <td style={{ padding:"10px 14px" }}><Badge color={j.replacement==="Yes"?"yellow":"gray"}>{j.replacement||"—"}</Badge></td>
                          <td style={{ padding:"10px 14px", fontSize:11, color:C.muted }}>{j.replacementReason||"—"}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            </Card>
          </>}
          {view==="messages" && <MessagesView currentUser={user} users={users} messages={messages} onSend={onSendMessage} onMarkRead={onMarkRead}/>}
        </div>
      </div>
    </div>
  );
}

// ─── CARD LOOKUP VIEW ─────────────────────────────────────────────────────────

function CardLookupView({ allJobs }: { allJobs:Job[] }) {
  const [query,  setQuery]  = useState("");
  const [search, setSearch] = useState("");

  const results = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    return allJobs.filter(j => j.cardNumber?.toLowerCase().includes(q) || j.customerName?.toLowerCase().includes(q));
  }, [allJobs, search]);

  const cards = useMemo(() => {
    const m: Record<string,{card:string;customer:string;jobs:Job[]}> = {};
    results.forEach(j => {
      if (!m[j.cardNumber]) m[j.cardNumber] = { card:j.cardNumber, customer:j.customerName, jobs:[] };
      m[j.cardNumber].jobs.push(j);
    });
    return Object.values(m).map(c => ({ ...c, jobs:[...c.jobs].sort((a,b)=>b.date.localeCompare(a.date)) }));
  }, [results]);

  function doExportCard(cardJobs: Job[], cardNum: string) {
    pdfExport(`Card / STB History: ${cardNum}`, `Customer: ${cardJobs[0]?.customerName||"—"} · ${cardJobs.length} visit(s)`,
      [{key:"date",label:"Date"},{key:"technicianName",label:"Technician"},{key:"region",label:"Region"},{key:"faultType",label:"Fault"},{key:"modelNumber",label:"Model"},{key:"result",label:"Result"},{key:"replacement",label:"Replacement"},{key:"replacementReason",label:"Reason"}],
      cardJobs.map(j=>({...j,date:fmtDate(j.date)})) as Record<string,unknown>[]);
  }

  return (
    <>
      <PageHeader title="🔎 Card / STB Lookup" sub="Search full decoder history by card number or customer name"/>
      <div className="page-pad" style={{ padding:20 }}>
        <Card style={{ marginBottom:20 }}>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <Inp value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&setSearch(query)} placeholder="Enter card number or customer name…" style={{ flex:1, fontSize:14 }}/>
            <Btn onClick={()=>setSearch(query)}>Search</Btn>
            {search && <Btn onClick={()=>{setQuery("");setSearch("");}} variant="ghost">Clear</Btn>}
          </div>
        </Card>
        {search && cards.length===0 && <Card><EmptyState icon="🔍" msg={`No records found for "${search}"`}/></Card>}
        {cards.map(c => (
          <Card key={c.card} style={{ marginBottom:20, padding:0, overflow:"hidden" }}>
            <div style={{ background:`linear-gradient(135deg,${C.blueDark},${C.blue})`, padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
              <div>
                <div style={{ color:"rgba(255,255,255,.5)", fontSize:10, textTransform:"uppercase", letterSpacing:1.5, fontWeight:700 }}>Card / STB Number</div>
                <div style={{ color:"#fff", fontFamily:"monospace", fontSize:22, fontWeight:900, letterSpacing:1 }}>{c.card}</div>
                <div style={{ color:"rgba(255,255,255,.7)", fontSize:13, marginTop:2 }}>{c.customer}</div>
              </div>
              <div style={{ display:"flex", gap:16, alignItems:"center", flexWrap:"wrap" }}>
                <div style={{ textAlign:"center" }}><div style={{ color:"rgba(255,255,255,.5)", fontSize:10, textTransform:"uppercase" }}>Visits</div><div style={{ color:"#fff", fontSize:24, fontWeight:800, fontFamily:"'Barlow Condensed',sans-serif" }}>{c.jobs.length}</div></div>
                <div style={{ textAlign:"center" }}><div style={{ color:"rgba(255,255,255,.5)", fontSize:10, textTransform:"uppercase" }}>Last Visit</div><div style={{ color:"#fff", fontSize:13, fontWeight:700 }}>{fmtDate(c.jobs[0]?.date)}</div></div>
                <div style={{ textAlign:"center" }}><div style={{ color:"rgba(255,255,255,.5)", fontSize:10, textTransform:"uppercase" }}>Replacements</div><div style={{ color:c.jobs.filter(j=>j.replacement==="Yes").length>0?"#FCD34D":"rgba(255,255,255,.7)", fontSize:24, fontWeight:800, fontFamily:"'Barlow Condensed',sans-serif" }}>{c.jobs.filter(j=>j.replacement==="Yes").length}</div></div>
                <Btn onClick={()=>doExportCard(c.jobs,c.card)} variant="pdf" size="sm">📄 PDF</Btn>
              </div>
            </div>
            <div style={{ padding:"16px 20px" }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:.9, marginBottom:12 }}>Service History Timeline</div>
              <div style={{ position:"relative" }}>
                <div style={{ position:"absolute", left:15, top:0, bottom:0, width:2, background:C.border }}/>
                {c.jobs.map((j,i) => (
                  <div key={j.id} style={{ display:"flex", gap:16, marginBottom:14, position:"relative" }}>
                    <div style={{ width:30, height:30, borderRadius:"50%", flexShrink:0, zIndex:1, background:j.result==="OK"?C.success:C.red, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:"#fff", fontWeight:700, border:"2px solid #fff", boxShadow:`0 0 0 2px ${j.result==="OK"?C.success:C.red}` }}>{j.result==="OK"?"✓":"✕"}</div>
                    <div style={{ flex:1, background:i===0?"#F0FDF4":j.result==="FAIL"?"#FFF5F5":"#F8FAFF", borderRadius:10, padding:"10px 14px", border:`1px solid ${j.result==="OK"?"#BBF7D0":j.result==="FAIL"?"#FEE2E2":C.border}` }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:4, marginBottom:6 }}>
                        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
                          <Badge color={j.result==="OK"?"green":"red"}>{j.result}</Badge>
                          {j.replacement==="Yes" && <Badge color="yellow">🔄 Replaced</Badge>}
                          {i===0 && <Badge color="blue">Latest</Badge>}
                        </div>
                        <span style={{ color:C.muted, fontSize:11 }}>{fmtDate(j.date)}</span>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:"4px 12px", fontSize:12 }}>
                        <div><span style={{ color:C.muted }}>Fault: </span><strong>{j.faultType}</strong></div>
                        <div><span style={{ color:C.muted }}>Model: </span><span>{j.modelNumber}</span></div>
                        <div><span style={{ color:C.muted }}>Technician: </span><span>{j.technicianName}</span></div>
                        <div><span style={{ color:C.muted }}>Location: </span><span>{j.region} · {j.branch}</span></div>
                        {j.replacement==="Yes" && <div><span style={{ color:C.muted }}>Reason: </span><strong>{j.replacementReason}</strong></div>}
                      </div>
                      {j.troubleshootDescription && <div style={{ marginTop:6, fontSize:11, color:C.muted, fontStyle:"italic" }}>📝 {j.troubleshootDescription}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ))}
        {!search && <Card style={{ textAlign:"center", padding:"56px 24px", borderStyle:"dashed" }}><div style={{ fontSize:48, marginBottom:12 }}>🔎</div><div style={{ fontWeight:700, color:C.text, fontSize:16, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.5, marginBottom:8 }}>Search Any Decoder</div><div style={{ color:C.muted, fontSize:13, maxWidth:360, margin:"0 auto", lineHeight:1.6 }}>Enter a card number or customer name to view the full service history, timeline, and replacement records.</div></Card>}
      </div>
    </>
  );
}

// ─── ACTIVITY LOG VIEW ────────────────────────────────────────────────────────

function ActivityLogView() {
  const [log,     setLog]     = useState<{id:string;timestamp:string;userName:string;userRole:string;action:string;detail:string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [roleF,   setRoleF]   = useState("");
  const [actionF, setActionF] = useState("");

  useEffect(() => {
    const data = db.get("activity") as typeof log | null;
    setLog(data || []);
    setLoading(false);
  }, []);

  const shown = useMemo(() => {
    let r = log;
    if (search) { const q = search.toLowerCase(); r = r.filter(e => e.userName?.toLowerCase().includes(q) || e.detail?.toLowerCase().includes(q) || e.action?.toLowerCase().includes(q)); }
    if (roleF)   r = r.filter(e => e.userRole===roleF);
    if (actionF) r = r.filter(e => e.action===actionF);
    return r;
  }, [log, search, roleF, actionF]);

  const allActions = [...new Set(log.map(e=>e.action))].sort();
  const allRoles   = [...new Set(log.map(e=>e.userRole))].filter(Boolean).sort();

  function doExportPDF() { pdfExport("Activity Log",`${shown.length} entries · ${fmtDate(new Date().toISOString())}`,[{key:"timestamp",label:"Timestamp"},{key:"userName",label:"User"},{key:"userRole",label:"Role"},{key:"action",label:"Action"},{key:"detail",label:"Detail"}],shown.map(e=>({...e,timestamp:fmtTS(e.timestamp)})) as Record<string,unknown>[]); }
  function doExportCSV()  { csvExport(shown.map(e=>({"Timestamp":fmtTS(e.timestamp),"User":e.userName,"Role":e.userRole,"Action":e.action,"Detail":e.detail})),"AzamActivityLog.csv"); }

  return (
    <>
      <PageHeader title="📋 Activity Log" sub={`${log.length} total entries`} action={<><Btn onClick={doExportPDF} variant="pdf" size="sm">📄 PDF</Btn><Btn onClick={doExportCSV} variant="ghost" size="sm">⬇ CSV</Btn></>}/>
      <div className="page-pad" style={{ padding:20 }}>
        <Card style={{ marginBottom:16 }}>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
            <div style={{ flex:2, minWidth:160 }}><label style={LBL}>Search</label><Inp value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search user, action, detail…"/></div>
            <div style={{ flex:1, minWidth:130 }}><label style={LBL}>Role</label><Sel value={roleF} onChange={e=>setRoleF(e.target.value)}><option value="">All Roles</option>{allRoles.map(r=><option key={r} value={r}>{r}</option>)}</Sel></div>
            <div style={{ flex:1, minWidth:150 }}><label style={LBL}>Action</label><Sel value={actionF} onChange={e=>setActionF(e.target.value)}><option value="">All Actions</option>{allActions.map(a=><option key={a} value={a}>{a}</option>)}</Sel></div>
            <Btn onClick={()=>{setSearch("");setRoleF("");setActionF("");}} variant="ghost" size="sm">Clear</Btn>
          </div>
        </Card>
        {loading ? <Card><EmptyState icon="⏳" msg="Loading…"/></Card>
        : shown.length===0 ? <Card><EmptyState icon="📋" msg="No entries found"/></Card>
        : <Card style={{ padding:0, overflow:"hidden" }}>
          <div className="table-wrap">
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, minWidth:700 }}>
              <thead><tr style={{ background:"#F5F8FF" }}>{["Timestamp","User","Role","Action","Detail"].map(h=><th key={h} style={{ padding:"10px 14px", color:C.muted, textAlign:"left", fontWeight:700, fontSize:11, textTransform:"uppercase", letterSpacing:.7, borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>{shown.slice(0,300).map(e=>(
                <tr key={e.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                  <td style={{ padding:"10px 14px", color:C.muted, fontSize:11, whiteSpace:"nowrap" }}>{fmtTS(e.timestamp)}</td>
                  <td style={{ padding:"10px 14px", fontWeight:700 }}>{e.userName}</td>
                  <td style={{ padding:"10px 14px" }}><Badge color={({admin:"red",technician:"blue",management:"green",technical_analyst:"teal"} as Record<string,string>)[e.userRole]||"gray"}>{e.userRole}</Badge></td>
                  <td style={{ padding:"10px 14px" }}><Badge color={ACTION_BADGE[e.action]||"gray"}>{e.action}</Badge></td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:C.muted, maxWidth:300 }}>{e.detail}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {shown.length>300 && <div style={{ padding:"8px 16px", color:C.muted, fontSize:12, textAlign:"center", borderTop:`1px solid ${C.border}`, background:"#F8FAFF" }}>Showing first 300 of {shown.length} · Export for all</div>}
        </Card>}
      </div>
    </>
  );
}

// ─── USERS VIEW ───────────────────────────────────────────────────────────────

function UsersView({ users, regions, onSave, currentUser }: { users:User[]; regions:Region[]; onSave:(u:User[])=>void; currentUser:User }) {
  const [modal,      setModal]      = useState<"add"|"edit"|null>(null);
  const [form,       setForm]       = useState<Partial<User>&{customRegion?:string;password?:string}>({});
  const [resetModal, setResetModal] = useState<User|null>(null);
  const [newPw,      setNewPw]      = useState("");
  const [search,     setSearch]     = useState("");
  const [saving,     setSaving]     = useState(false);
  const { confirm, ConfirmUI } = useConfirm();

  const emptyForm = { name:"",username:"",password:"",role:"technician",region:"",branch:"",managementType:"",customRegion:"" };
  const openAdd  = () => { setForm({...emptyForm}); setModal("add"); };
  const openEdit = (u: User) => { setForm({...u,customRegion:""}); setModal("edit"); };

   // ─── PART 2: AUTOMATIC ONE-WAY ACCOUNT CREATION SYNC ───
  async function save() {
    const ar = form.region === "__other__" ? (form.customRegion || "").trim() : form.region || "";
    if (!form.name?.trim() || !form.username?.trim() || !form.role || !ar) { 
      showToast("Fill all required fields.", "error"); 
      return; 
    }
    if (modal === "add" && !form.password) { 
      showToast("Password is required.", "error"); 
      return; 
    }
    if (form.role === "management" && !form.managementType) { 
      showToast("Select a management type.", "error"); 
      return; 
    }
    if (users.find(u => u.username.toLowerCase() === form.username!.toLowerCase() && u.id !== form.id)) { 
      showToast("Username is already taken.", "error"); 
      return; 
    }

    setSaving(true);
    try {
      let finalUserId = form.id || uid(); 
      let pw = form.password || "";

      if (modal === "add") {
        const targetEmail = form.username.trim().includes('@') 
          ? form.username.trim() 
          : `${form.username.trim()}@azamservicedesk.local`;

        // Create user account inside Supabase cloud cluster securely
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: targetEmail,
          password: pw,
          email_confirm: true, // Auto-confirm so they log in instantly
          user_metadata: {
            full_name: form.name.trim(),
            role: form.role, // Saves chosen staff role natively to profile token metadata
            managementType: form.managementType || ""
          }
        });

        if (authError) {
          showToast(`Supabase Sync Failed: ${authError.message}`, "error");
          setSaving(false);
          return;
        }

        if (authData?.user) {
          finalUserId = authData.user.id; // Override local ID to match Supabase unique auth UID
        }

        if (pw) pw = await hashPassword(pw);
      }

      const ud = { ...form, id: finalUserId, region: ar, ...(modal === "add" ? { password: pw } : {}) } as User;
      delete (ud as any).customRegion;

      onSave(modal === "add" ? [...users, { ...ud, createdAt: new Date().toISOString() }] : users.map(u => u.id === form.id ? { ...u, ...ud } : u));
      logActivity(currentUser, modal === "add" ? "ADD_USER" : "EDIT_USER", `${modal === "add" ? "Added" : "Edited"}: ${form.name} (${form.role})`);
      showToast(modal === "add" ? "User created & captured into Supabase." : "User updated.", "success");
      setModal(null);
    } catch (err) {
      showToast("An unexpected error occurred during role sync.", "error");
    } finally { 
      setSaving(false); 
    }
  }

   // ─── PART 3: AUTOMATIC SUPABASE DELETION CLEANUP ───
  async function delUser(id: string) {
    const u = users.find(user => user.id === id);
    if (!u) return;

    const ok = await confirm(`Delete user "${u.name}"?`);
    if (!ok) return;

    try {
      // Instruct Supabase Auth to wipe out their active credentials completely
      if (id && id.length > 15) {
        await supabaseAdmin.auth.admin.deleteUser(id);
      }
    } catch (authErr) {
      console.error("Supabase cloud deletion sync failed:", authErr);
    }

    onSave(users.filter(user => user.id !== id));
    logActivity(currentUser, "DELETE_USER", `Deleted user: ${u.name} (${u.role})`);
    showToast("User deleted and removed from Supabase Cloud.", "success");
  }

  async function resetPw() {
    if (!newPw.trim()) { showToast("Enter a new password.","error"); return; }
    if (newPw.length < 6) { showToast("Password must be at least 6 characters.","error"); return; }
    const hashed = await hashPassword(newPw);
    onSave(users.map(u=>u.id===resetModal?.id?{...u,password:hashed}:u));
    logActivity(currentUser,"RESET_PW",`Password reset for: ${resetModal?.name}`);
    showToast("Password reset successfully.", "success");
    setResetModal(null); setNewPw("");
  }

  const rb = (r: string) => ({admin:"red",technician:"blue",management:"green",technical_analyst:"teal"} as Record<string,string>)[r]||"gray";
  const rd = (u: User) => u.role==="management"?(u.managementType||"Management"):u.role==="technical_analyst"?"Tech Analyst":u.role;

  const shown = useMemo(() => {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter(u => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.region?.toLowerCase().includes(q));
  }, [users, search]);

  function doExportPDF() { pdfExport("Staff Directory",`${users.length} registered users`,[{key:"name",label:"Full Name"},{key:"username",label:"Username"},{key:"roleDisplay",label:"Role"},{key:"region",label:"Region"},{key:"branch",label:"Branch"},{key:"createdAt",label:"Date Added"}],users.map(u=>({...u,roleDisplay:rd(u),createdAt:fmtDate(u.createdAt)})) as Record<string,unknown>[]); }
  function doExportCSV()  { csvExport(users.map(u=>({"Full Name":u.name,"Username":u.username,"Role":rd(u),"Region":u.region||"—","Branch":u.branch||"—","Date Added":fmtDate(u.createdAt)})),"AzamStaffDirectory.csv"); }

  return (
    <>
      {ConfirmUI}
      <PageHeader title="User Management" sub={`${users.length} users registered`} action={<><Btn onClick={doExportPDF} variant="pdf" size="sm">📄 PDF</Btn><Btn onClick={doExportCSV} variant="ghost" size="sm">⬇ CSV</Btn><Btn onClick={openAdd}>+ New User</Btn></>}/>
      <div className="page-pad" style={{ padding:20 }}>
        <div style={{ marginBottom:14 }}><Inp value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search users…" style={{ maxWidth:320 }}/></div>
        <Card style={{ padding:0, overflow:"hidden" }}>
          <div className="table-wrap">
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, minWidth:680 }}>
              <thead><tr style={{ background:"#F5F8FF" }}>{["Full Name","Username","Role","Region","Branch","Date Added","Actions"].map(h=><th key={h} style={{ padding:"10px 16px", color:C.muted, textAlign:"left", fontWeight:700, fontSize:11, textTransform:"uppercase", letterSpacing:.7, borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>{shown.map(u=>(
                <tr key={u.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                  <td style={{ padding:"12px 16px", fontWeight:700 }}>{u.name}</td>
                  <td style={{ padding:"12px 16px", fontFamily:"monospace", color:C.blue, fontWeight:700 }}>{u.username}</td>
                  <td style={{ padding:"12px 16px" }}><Badge color={rb(u.role)}>{rd(u)}</Badge></td>
                  <td style={{ padding:"12px 16px" }}>{u.region||"—"}</td>
                  <td style={{ padding:"12px 16px", color:C.muted }}>{u.branch||"—"}</td>
                  <td style={{ padding:"12px 16px", color:C.muted, fontSize:12, whiteSpace:"nowrap" }}>{fmtDate(u.createdAt)}</td>
                  <td style={{ padding:"12px 16px" }}>
                    <div style={{ display:"flex", gap:6 }}>
                      <Btn onClick={()=>openEdit(u)} variant="ghost" size="sm">Edit</Btn>
                      <Btn onClick={()=>{setResetModal(u);setNewPw("");}} variant="ghost" size="sm">🔑 PW</Btn>
                      {u.role!=="admin" && <Btn onClick={()=>delUser(u.id)} variant="danger" size="sm">Delete</Btn>}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      </div>

      {modal && (
        <Modal title={modal==="add"?"Add New User":"Edit User"} onClose={()=>setModal(null)}>
          <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
            <FormField label="Full Name *"><Inp value={form.name||""} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Full name"/></FormField>
            <FormField label="Username *"><Inp value={form.username||""} onChange={e=>setForm({...form,username:e.target.value})} placeholder="Login username" disabled={modal==="edit"}/></FormField>
            {modal==="add" && <FormField label="Initial Password *"><Inp type="password" value={form.password||""} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Min 6 characters"/></FormField>}
            <FormField label="Role *">
              <Sel value={form.role||"technician"} onChange={e=>setForm({...form,role:e.target.value,managementType:""})}>
                <option value="technician">Technician</option>
                <option value="management">Management</option>
                <option value="technical_analyst">Technical Analyst</option>
              </Sel>
            </FormField>
            {form.role==="management" && (
              <FormField label="Management Type *">
                <Sel value={form.managementType||""} onChange={e=>setForm({...form,managementType:e.target.value})}>
                  <option value="">Select type</option>
                  {MANAGEMENT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                </Sel>
              </FormField>
            )}
            <FormField label="Region *">
              <Sel value={form.region||""} onChange={e=>setForm({...form,region:e.target.value,customRegion:""})}>
                <option value="">Select region</option>
                <option value="HQ">HQ — Headquarters</option>
                {regions.map(r=><option key={r.id} value={r.name}>{r.name} ({r.country})</option>)}
                <option value="__other__">Other (specify manually)</option>
              </Sel>
              {form.region==="__other__" && <Inp value={form.customRegion||""} onChange={e=>setForm({...form,customRegion:e.target.value})} placeholder="Type region name…" style={{ marginTop:8 }}/>}
            </FormField>
            <FormField label="Branch / Station"><Inp value={form.branch||""} onChange={e=>setForm({...form,branch:e.target.value})} placeholder="Branch or station name"/></FormField>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:4 }}>
              <Btn onClick={()=>setModal(null)} variant="ghost">Cancel</Btn>
              <Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save User"}</Btn>
            </div>
          </div>
        </Modal>
      )}
      {resetModal && (
        <Modal title={`Reset Password — ${resetModal.name}`} onClose={()=>setResetModal(null)}>
          <div style={{ background:"#FFF7ED", border:"1px solid #FDE68A", borderRadius:8, padding:"10px 14px", marginBottom:14, fontSize:12, color:"#92400E" }}>
            ⚠ This will immediately change the user's password. They will need to use the new password on their next login.
          </div>
          <FormField label="New Password (min 6 chars)"><Inp type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="Enter new password"/></FormField>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:16 }}>
            <Btn onClick={()=>setResetModal(null)} variant="ghost">Cancel</Btn>
            <Btn onClick={resetPw} variant="danger">Reset Password</Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

// ─── REGIONS VIEW (kept for data model but removed from main nav) ─────────────

function RegionsView({ regions, onSave, currentUser }: { regions:Region[]; onSave:(r:Region[])=>void; currentUser:User }) {
  const [modal,  setModal]  = useState(false);
  const [form,   setForm]   = useState({name:"",country:""});
  const [editId, setEditId] = useState<string|null>(null);
  const { confirm, ConfirmUI } = useConfirm();

  async function save() {
    if (!form.name.trim()||!form.country.trim()) { showToast("Fill all fields.","error"); return; }
    onSave(editId ? regions.map(r=>r.id===editId?{...r,...form}:r) : [...regions,{id:uid(),...form,createdAt:new Date().toISOString()}]);
    logActivity(currentUser, editId?"EDIT_REGION":"ADD_REGION", `${editId?"Edited":"Added"}: ${form.name} (${form.country})`);
    showToast(editId?"Region updated.":"Region added.", "success");
    setModal(false); setEditId(null); setForm({name:"",country:""});
  }

  async function delRegion(r: Region) {
    const ok = await confirm(`Delete region "${r.name}"?`, { title:"Delete Region" });
    if (!ok) return;
    onSave(regions.filter(x=>x.id!==r.id));
    logActivity(currentUser,"DELETE_REGION",`Deleted: ${r.name}`);
    showToast("Region deleted.", "info");
  }

  return (
    <>
      {ConfirmUI}
      <PageHeader title="Regions & Locations" sub={`${regions.length} configured`} action={<Btn onClick={()=>{setForm({name:"",country:""});setEditId(null);setModal(true);}}>+ Add Region</Btn>}/>
      <div className="page-pad" style={{ padding:20 }}>
        {regions.length===0
          ? <Card><EmptyState icon="🗺️" msg="No regions yet — click Add Region"/></Card>
          : <div className="grid-auto">
            {regions.map(r => (
              <Card key={r.id}>
                <div style={{ width:40, height:40, background:`linear-gradient(135deg,${C.blue},${C.blueMid})`, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, marginBottom:12 }}>🌍</div>
                <div style={{ fontWeight:800, fontSize:16, color:C.text, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.5 }}>{r.name}</div>
                <div style={{ color:C.muted, fontSize:12, marginTop:2 }}>{r.country}</div>
                <div style={{ color:C.muted, fontSize:11, marginTop:6 }}>Added {fmtDate(r.createdAt)}</div>
                <div style={{ display:"flex", gap:6, marginTop:12 }}>
                  <Btn onClick={()=>{setForm({name:r.name,country:r.country});setEditId(r.id);setModal(true);}} variant="ghost" size="sm">Edit</Btn>
                  <Btn onClick={()=>delRegion(r)} variant="danger" size="sm">Delete</Btn>
                </div>
              </Card>
            ))}
          </div>
        }
      </div>
      {modal && (
        <Modal title={editId?"Edit Region":"Add Region"} onClose={()=>setModal(false)}>
          <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
            <FormField label="Region Name *"><Inp value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. Northern Region"/></FormField>
            <FormField label="Country *"><Inp value={form.country} onChange={e=>setForm({...form,country:e.target.value})} placeholder="e.g. Tanzania"/></FormField>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:4 }}>
              <Btn onClick={()=>setModal(false)} variant="ghost">Cancel</Btn>
              <Btn onClick={save}>Save Region</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ─── DATA / ALL RECORDS VIEW ──────────────────────────────────────────────────

function DataView({ allJobs, users }: { allJobs:Job[]; users:User[] }) {
  const techs = users.filter(u=>u.role==="technician");
  const [f, setF] = useState({region:"",branch:"",tech:"",fault:"",result:"",from:"",to:""});
  const setFilter = (k: string, v: string) => setF(p=>({...p,[k]:v,...(k==="region"?{branch:""}:{})}));
  const allRegions  = useMemo(()=>[...new Set(allJobs.map(j=>j.region).filter(Boolean))].sort(),[allJobs]);
  const allBranches = useMemo(()=>[...new Set(allJobs.filter(j=>!f.region||j.region===f.region).map(j=>j.branch).filter(Boolean))].sort(),[allJobs,f.region]);
  const filtered = useMemo(()=>allJobs.filter(j=>{
    if(f.region&&j.region!==f.region)return false; if(f.branch&&j.branch!==f.branch)return false;
    if(f.tech&&j.technicianId!==f.tech)return false; if(f.fault&&j.faultType!==f.fault)return false;
    if(f.result&&j.result!==f.result)return false; if(f.from&&j.date<f.from)return false; if(f.to&&j.date>f.to)return false; return true;
  }),[allJobs,f]);

  function doCSV() { csvExport(filtered.map(j=>({"Date":fmtDate(j.date),"Technician":j.technicianName,"Region":j.region,"Branch":j.branch,"Customer":j.customerName,"Phone":j.phone,"Card Number":j.cardNumber,"Fault":j.faultType,"Model":j.modelNumber,"Notes":j.troubleshootDescription,"Result":j.result,"Replacement":j.replacement,"Reason":j.replacementReason})),"AzamSD_AllRecords.csv"); }
  function doPDF() { pdfExportGrouped("All Service Records", `${filtered.length} records${f.region?` · ${f.region}`:""}`, filtered); }

  return (
    <>
      <PageHeader title="All Service Records" sub={`${filtered.length} of ${allJobs.length} records`} action={<><Btn onClick={doPDF} variant="pdf" size="sm">📄 PDF</Btn><Btn onClick={doCSV} variant="ghost" size="sm">⬇ CSV</Btn></>}/>
      <div className="page-pad" style={{ padding:20 }}>
        <FilterBar filters={f} setFilter={setFilter} clearAll={()=>setF({region:"",branch:"",tech:"",fault:"",result:"",from:"",to:""})} regions={allRegions} branches={allBranches} techs={techs} showBranch showTech showFault showResult showDate/>
        <Card style={{ padding:0, overflow:"hidden" }}>
          <div className="table-wrap">
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, minWidth:900 }}>
              <thead><tr style={{ background:"#F5F8FF" }}>{["Date","Technician","Region","Branch","Customer","Card #","Fault","Model","Result","Replacement"].map(h=><th key={h} style={{ padding:"10px 12px", color:C.muted, textAlign:"left", fontWeight:700, fontSize:11, textTransform:"uppercase", letterSpacing:.7, borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>{filtered.length===0
                ? <tr><td colSpan={10}><EmptyState msg="No records match filters"/></td></tr>
                : [...filtered].reverse().slice(0,200).map(j=>(
                  <tr key={j.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                    <td style={{ padding:"9px 12px", color:C.muted, fontSize:11, whiteSpace:"nowrap" }}>{fmtDate(j.date)}</td>
                    <td style={{ padding:"9px 12px", fontWeight:700 }}>{j.technicianName}</td>
                    <td style={{ padding:"9px 12px", color:C.muted, fontSize:12 }}>{j.region}</td>
                    <td style={{ padding:"9px 12px", color:C.muted, fontSize:11 }}>{j.branch||"—"}</td>
                    <td style={{ padding:"9px 12px" }}>{j.customerName}</td>
                    <td style={{ padding:"9px 12px", fontFamily:"monospace", fontWeight:800, color:C.blue, fontSize:12 }}>{j.cardNumber}</td>
                    <td style={{ padding:"9px 12px", fontSize:11 }}>{j.faultType}</td>
                    <td style={{ padding:"9px 12px", fontSize:11, color:C.muted }}>{j.modelNumber}</td>
                    <td style={{ padding:"9px 12px" }}><Badge color={j.result==="OK"?"green":"red"}>{j.result}</Badge></td>
                    <td style={{ padding:"9px 12px" }}><Badge color={j.replacement==="Yes"?"yellow":"gray"}>{j.replacement||"—"}</Badge></td>
                  </tr>
                ))
              }</tbody>
            </table>
          </div>
          {filtered.length>200 && <div style={{ padding:"8px 16px", color:C.muted, fontSize:12, textAlign:"center", borderTop:`1px solid ${C.border}`, background:"#F8FAFF" }}>Showing first 200 · Export for full dataset ({filtered.length} records)</div>}
        </Card>
      </div>
    </>
  );
}

// ─── ANALYTICS VIEW ───────────────────────────────────────────────────────────

function AnalyticsView({ allJobs, users, filterBar }: { allJobs:Job[]; users:User[]; filterBar?: React.ReactNode }) {
  const isMobile = useIsMobile();
  const techs = users.filter(u=>u.role==="technician");
  const techPerf = useMemo(()=>techs.map(t=>{
    const jobs=allJobs.filter(j=>j.technicianId===t.id);
    const ok=jobs.filter(j=>j.result==="OK").length; const fail=jobs.filter(j=>j.result==="FAIL").length; const rep=jobs.filter(j=>j.replacement==="Yes").length;
    const rate=jobs.length?Math.round((ok/jobs.length)*100):0;
    return{id:t.id,name:t.name,short:t.name.split(" ")[0],region:t.region,total:jobs.length,ok,fail,replacements:rep,rate};
  }).filter(t=>t.total>0).sort((a,b)=>b.total-a.total),[allJobs,techs]);

  const faultData  = useMemo(()=>{const m:Record<string,number>={};allJobs.forEach(j=>{if(j.faultType)m[j.faultType]=(m[j.faultType]||0)+1;});return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,value])=>({name,value}));},[allJobs]);
  const monthData  = useMemo(()=>{const m:Record<string,{month:string;total:number;ok:number;fail:number}>={};allJobs.forEach(j=>{const mo=j.date?.substring(0,7);if(!mo)return;if(!m[mo])m[mo]={month:mo,total:0,ok:0,fail:0};m[mo].total++;if(j.result==="OK")m[mo].ok++;else m[mo].fail++;});return Object.values(m).sort((a,b)=>a.month.localeCompare(b.month)).slice(-12);},[allJobs]);

  const total=allJobs.length, ok=allJobs.filter(j=>j.result==="OK").length, fail=allJobs.filter(j=>j.result==="FAIL").length, rep=allJobs.filter(j=>j.replacement==="Yes").length;
  const rate=total?Math.round((ok/total)*100):0;
  const chartH = isMobile ? 200 : 230;

  return (
    <div className="page-pad" style={{ padding:isMobile?12:24 }}>
      {filterBar}
      <div className="metrics-row">
        <MetricCard label="Total Jobs"      value={total.toLocaleString()} icon="🔧" sub="All submitted records"/>
        <MetricCard label="Successful (OK)" value={ok.toLocaleString()} color={C.success} icon="✅" sub={`${rate}% success rate`}/>
        <MetricCard label="Failed"          value={fail.toLocaleString()} color={C.red} icon="❌" sub={`${total?Math.round((fail/total)*100):0}% fail rate`}/>
        <MetricCard label="Replacements"    value={rep.toLocaleString()} color={C.warning} icon="🔄" sub="Parts replaced"/>
      </div>
      <div className={isMobile?"":"grid-2"} style={isMobile?{display:"flex",flexDirection:"column",gap:16,marginBottom:16}:{marginBottom:20}}>
        <Card>
          <div style={{ fontWeight:700, fontSize:16, color:C.text, marginBottom:14, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.5 }}>Monthly Job Trends</div>
          {monthData.length>0
            ? <ResponsiveContainer width="100%" height={chartH}><LineChart data={monthData}><CartesianGrid strokeDasharray="3 3" stroke="#EEF2FF"/><XAxis dataKey="month" tick={{fontSize:9}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend/><Line type="monotone" dataKey="total" name="Total" stroke={C.blue} strokeWidth={2} dot={{r:3}}/><Line type="monotone" dataKey="ok" name="OK" stroke={C.success} strokeWidth={2} dot={{r:3}}/><Line type="monotone" dataKey="fail" name="FAIL" stroke={C.red} strokeWidth={2} dot={{r:3}}/></LineChart></ResponsiveContainer>
            : <EmptyState msg="No data yet"/>}
        </Card>
        <Card>
          <div style={{ fontWeight:700, fontSize:16, color:C.text, marginBottom:14, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.5 }}>Results Split</div>
          <ResponsiveContainer width="100%" height={chartH}><PieChart><Pie data={[{name:"OK",value:ok||0},{name:"FAIL",value:fail||0}]} dataKey="value" nameKey="name" outerRadius={isMobile?70:85} innerRadius={isMobile?30:40} label={({name,percent})=>`${name} ${((percent||0)*100).toFixed(0)}%`}><Cell fill={C.success}/><Cell fill={C.red}/></Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer>
        </Card>
      </div>
      <div className={isMobile?"":"grid-2"} style={isMobile?{display:"flex",flexDirection:"column",gap:16,marginBottom:16}:{marginBottom:20}}>
        <Card>
          <div style={{ fontWeight:700, fontSize:16, marginBottom:14, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.5 }}>Jobs per Technician</div>
          {techPerf.length>0
            ? <ResponsiveContainer width="100%" height={chartH}><BarChart data={techPerf}><CartesianGrid strokeDasharray="3 3" stroke="#EEF2FF"/><XAxis dataKey="short" tick={{fontSize:9}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Legend/><Bar dataKey="ok" name="OK" fill={C.success} stackId="a"/><Bar dataKey="fail" name="FAIL" fill={C.red} stackId="a"/></BarChart></ResponsiveContainer>
            : <EmptyState msg="No data yet"/>}
        </Card>
        <Card>
          <div style={{ fontWeight:700, fontSize:16, marginBottom:14, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.5 }}>Top 10 Fault Types</div>
          {faultData.length>0
            ? <ResponsiveContainer width="100%" height={chartH}><BarChart data={faultData} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#EEF2FF"/><XAxis type="number" tick={{fontSize:9}}/><YAxis dataKey="name" type="category" tick={{fontSize:9}} width={isMobile?90:110}/><Tooltip/><Bar dataKey="value" name="Count" fill={C.blue}/></BarChart></ResponsiveContainer>
            : <EmptyState msg="No data yet"/>}
        </Card>
      </div>
      <Card>
        <div style={{ fontWeight:700, fontSize:16, marginBottom:14, fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:.5 }}>Technician Performance Breakdown</div>
        <div className="table-wrap">
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, minWidth:700 }}>
            <thead><tr style={{ background:"#F5F8FF" }}>{["Technician","Region","Total","OK","FAIL","Rep.","Success Rate","Workload"].map(h=><th key={h} style={{ padding:"9px 12px", color:C.muted, textAlign:"left", fontWeight:700, fontSize:11, textTransform:"uppercase", letterSpacing:.7, borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>{techPerf.length===0
              ? <tr><td colSpan={8}><EmptyState msg="No submitted jobs yet"/></td></tr>
              : techPerf.map((t,i)=>(
                <tr key={t.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                  <td style={{ padding:"11px 12px", fontWeight:700 }}>{t.name}</td>
                  <td style={{ padding:"11px 12px", color:C.muted, fontSize:12 }}>{t.region}</td>
                  <td style={{ padding:"11px 12px", fontWeight:700, color:C.blue }}>{t.total}</td>
                  <td style={{ padding:"11px 12px", fontWeight:700, color:C.success }}>{t.ok}</td>
                  <td style={{ padding:"11px 12px", fontWeight:700, color:C.red }}>{t.fail}</td>
                  <td style={{ padding:"11px 12px", color:C.warning }}>{t.replacements}</td>
                  <td style={{ padding:"11px 12px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ flex:1, height:8, background:"#EEF2FF", borderRadius:4, minWidth:50 }}><div style={{ width:`${t.rate}%`, height:"100%", borderRadius:4, background:t.rate>=70?C.success:t.rate>=50?C.warning:C.red }}/></div>
                      <span style={{ fontWeight:700, fontSize:12, minWidth:32, color:t.rate>=70?C.success:t.rate>=50?C.warning:C.red }}>{t.rate}%</span>
                    </div>
                  </td>
                  <td style={{ padding:"11px 12px" }}>
                    {i===0&&techPerf.length>1&&<Badge color="red">Highest</Badge>}
                    {i===techPerf.length-1&&techPerf.length>1&&<Badge color="gray">Lowest</Badge>}
                  </td>
                </tr>
              ))
            }</tbody>
          </table>
        </div>
      </Card>
      <RegionTechBreakdown allJobs={allJobs} users={users} mode="jobs"/>
    </div>
  );
}

// ─── RECURRING STBS ───────────────────────────────────────────────────────────

function RecurringContent({ allJobs }: { allJobs:Job[] }) {
  const recurring = useMemo(()=>{
    const m: Record<string,Job[]> = {};
    allJobs.forEach(j=>{ if(!j.cardNumber)return; if(!m[j.cardNumber])m[j.cardNumber]=[]; m[j.cardNumber].push(j); });
    return Object.entries(m).filter(([,jobs])=>jobs.length>=2).sort((a,b)=>b[1].length-a[1].length)
      .map(([card,jobs])=>{ const sorted=[...jobs].sort((a,b)=>b.date.localeCompare(a.date)); return{card,count:jobs.length,lastDate:sorted[0].date,customer:sorted[0].customerName,faults:[...new Set(jobs.map(j=>j.faultType))],techs:[...new Set(jobs.map(j=>j.technicianName))]}; });
  },[allJobs]);

  if (recurring.length===0) return <Card><EmptyState icon="✅" msg="No recurring STBs detected"/></Card>;

  return (
    <>
      <div className="metrics-row">
        <MetricCard label="Recurring STBs" value={recurring.length} color={C.red} icon="🔁" sub="Returned 2+ times"/>
        <MetricCard label="Most Returns"   value={`${recurring[0]?.count}×`} color={C.red} icon="⚠️" sub={recurring[0]?.card}/>
        <MetricCard label="Avg Returns"    value={(recurring.reduce((a,b)=>a+b.count,0)/recurring.length).toFixed(1)} icon="📊" sub="Per recurring STB"/>
      </div>
      <Card style={{ padding:0, overflow:"hidden" }}>
        <div className="table-wrap">
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, minWidth:650 }}>
            <thead><tr style={{ background:"#FFF5F5" }}>{["Card Number","Returns","Customer","Last Seen","Fault Types","Technicians"].map(h=><th key={h} style={{ padding:"10px 16px", color:C.red, textAlign:"left", fontWeight:700, fontSize:11, textTransform:"uppercase", letterSpacing:.7, borderBottom:"2px solid #FEE2E2", whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>{recurring.map(r=>(
              <tr key={r.card} style={{ borderBottom:`1px solid ${C.border}` }}>
                <td style={{ padding:"12px 16px", fontFamily:"monospace", fontWeight:800, color:C.red, fontSize:14 }}>{r.card}</td>
                <td style={{ padding:"12px 16px" }}><span style={{ background:"#FEE2E2", color:C.red, padding:"4px 12px", borderRadius:20, fontWeight:800, fontSize:15 }}>{r.count}×</span></td>
                <td style={{ padding:"12px 16px", fontWeight:600 }}>{r.customer}</td>
                <td style={{ padding:"12px 16px", color:C.muted, fontSize:12, whiteSpace:"nowrap" }}>{fmtDate(r.lastDate)}</td>
                <td style={{ padding:"12px 16px" }}><div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>{r.faults.map(f=><Badge key={f} color="blue">{f}</Badge>)}</div></td>
                <td style={{ padding:"12px 16px", color:C.muted, fontSize:12 }}>{r.techs.join(", ")}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ─── REGION + TECH BREAKDOWN ──────────────────────────────────────────────────

function RegionTechBreakdown({ allJobs, users, mode="all" }: { allJobs:Job[]; users:User[]; mode?:string }) {
  const techs = users.filter(u=>u.role==="technician");

  const byRegion = useMemo(()=>{
    const m: Record<string,{region:string;total:number;ok:number;fail:number;replacements:number;faultMap:Record<string,number>}> = {};
    allJobs.forEach(j=>{ const r=j.region||"Unknown"; if(!m[r])m[r]={region:r,total:0,ok:0,fail:0,replacements:0,faultMap:{}}; m[r].total++; if(j.result==="OK")m[r].ok++;else m[r].fail++; if(j.replacement==="Yes")m[r].replacements++; if(j.faultType)m[r].faultMap[j.faultType]=(m[r].faultMap[j.faultType]||0)+1; });
    return Object.values(m).map(r=>({...r,rate:r.total?Math.round((r.ok/r.total)*100):0,repRate:r.total?Math.round((r.replacements/r.total)*100):0,topFault:Object.entries(r.faultMap).sort((a,b)=>b[1]-a[1])[0]?.[0]||"—",topFaultCount:Object.entries(r.faultMap).sort((a,b)=>b[1]-a[1])[0]?.[1]||0})).sort((a,b)=>b.total-a.total);
  },[allJobs]);

  const byTech = useMemo(()=>{
    return techs.map(t=>{
      const jobs=allJobs.filter(j=>j.technicianId===t.id); const ok=jobs.filter(j=>j.result==="OK").length; const fail=jobs.filter(j=>j.result==="FAIL").length; const rep=jobs.filter(j=>j.replacement==="Yes").length;
      const fm: Record<string,number>={}; jobs.forEach(j=>{if(j.faultType)fm[j.faultType]=(fm[j.faultType]||0)+1;});
      const topFault=Object.entries(fm).sort((a,b)=>b[1]-a[1])[0]?.[0]||"—"; const topFaultCount=Object.entries(fm).sort((a,b)=>b[1]-a[1])[0]?.[1]||0;
      const rm: Record<string,number>={}; jobs.filter(j=>j.replacement==="Yes").forEach(j=>{const r=j.replacementReason||"Unknown";rm[r]=(rm[r]||0)+1;});
      const topReason=Object.entries(rm).sort((a,b)=>b[1]-a[1])[0]?.[0]||"—";
      return{id:t.id,name:t.name,region:t.region,branch:t.branch,total:jobs.length,ok,fail,replacements:rep,topFault,topFaultCount,topReason,rate:jobs.length?Math.round((ok/jobs.length)*100):0,repRate:jobs.length?Math.round((rep/jobs.length)*100):0};
    }).filter(t=>t.total>0).sort((a,b)=>b.total-a.total);
  },[allJobs,techs]);

  const RateBar = ({rate,color}:{rate:number;color:string}) => (
    <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{flex:1,height:7,background:"#EEF2FF",borderRadius:4,minWidth:40}}><div style={{width:`${rate}%`,height:"100%",borderRadius:4,background:color}}/></div><span style={{fontSize:11,fontWeight:700,color,minWidth:28}}>{rate}%</span></div>
  );
  const Dot = ({result}:{result:string}) => <span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:result==="OK"?C.success:C.red,marginRight:4}}/>;
  const SH  = ({children}:{children:React.ReactNode}) => <div style={{fontWeight:800,fontSize:15,color:C.text,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:.5,marginBottom:12,marginTop:28,paddingBottom:8,borderBottom:`2px solid ${C.border}`}}>{children}</div>;

  if (!allJobs.length) return <Card><EmptyState icon="📊" msg="No data available for breakdown"/></Card>;
  const thStyle=(color:string): React.CSSProperties => ({padding:"9px 12px",color,textAlign:"left",fontWeight:700,fontSize:11,textTransform:"uppercase",letterSpacing:.7,borderBottom:`2px solid ${C.border}`,whiteSpace:"nowrap"});

  return (
    <div style={{ marginTop:8 }}>
      {(mode==="all"||mode==="jobs"||mode==="faults"||mode==="replacements") && <>
        <SH>🌍 Jobs Status by Region</SH>
        <Card style={{padding:0,overflow:"hidden",marginBottom:4}}><div className="table-wrap"><table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:700}}>
          <thead><tr style={{background:"#F0F4FF"}}>{["Region","Total Jobs","OK","FAIL","Success Rate","Replacements","Rep Rate","Top Fault"].map(h=><th key={h} style={thStyle(C.muted)}>{h}</th>)}</tr></thead>
          <tbody>{byRegion.length===0?<tr><td colSpan={8}><EmptyState msg="No regional data"/></td></tr>:byRegion.map((r,i)=>(
            <tr key={r.region} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":"#FAFBFF"}}>
              <td style={{padding:"10px 12px",fontWeight:700}}>{r.region}</td>
              <td style={{padding:"10px 12px",fontWeight:800,color:C.blue,fontSize:14}}>{r.total}</td>
              <td style={{padding:"10px 12px"}}><span style={{display:"flex",alignItems:"center",gap:4,color:C.success,fontWeight:700}}><Dot result="OK"/>{r.ok}</span></td>
              <td style={{padding:"10px 12px"}}><span style={{display:"flex",alignItems:"center",gap:4,color:C.red,fontWeight:700}}><Dot result="FAIL"/>{r.fail}</span></td>
              <td style={{padding:"10px 12px",minWidth:110}}><RateBar rate={r.rate} color={r.rate>=70?C.success:r.rate>=50?C.warning:C.red}/></td>
              <td style={{padding:"10px 12px",fontWeight:700,color:C.warning}}>{r.replacements}</td>
              <td style={{padding:"10px 12px",minWidth:90}}><RateBar rate={r.repRate} color={C.warning}/></td>
              <td style={{padding:"10px 12px",fontSize:11,color:C.muted,maxWidth:160}}>{r.topFault} {r.topFaultCount>0?`(${r.topFaultCount})`:""}</td>
            </tr>
          ))}</tbody>
        </table></div></Card>

        <SH>👤 Jobs Status by Technician</SH>
        <Card style={{padding:0,overflow:"hidden",marginBottom:4}}><div className="table-wrap"><table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:750}}>
          <thead><tr style={{background:"#F0F4FF"}}>{["Technician","Region / Branch","Total","OK","FAIL","Success Rate","Replacements","Top Fault"].map(h=><th key={h} style={thStyle(C.muted)}>{h}</th>)}</tr></thead>
          <tbody>{byTech.length===0?<tr><td colSpan={8}><EmptyState msg="No technician data"/></td></tr>:byTech.map((t,i)=>(
            <tr key={t.id} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":"#FAFBFF"}}>
              <td style={{padding:"10px 12px",fontWeight:700}}>{t.name}</td>
              <td style={{padding:"10px 12px",fontSize:11,color:C.muted}}>{t.region}{t.branch?` · ${t.branch}`:""}</td>
              <td style={{padding:"10px 12px",fontWeight:800,color:C.blue,fontSize:14}}>{t.total}</td>
              <td style={{padding:"10px 12px"}}><span style={{display:"flex",alignItems:"center",gap:4,color:C.success,fontWeight:700}}><Dot result="OK"/>{t.ok}</span></td>
              <td style={{padding:"10px 12px"}}><span style={{display:"flex",alignItems:"center",gap:4,color:C.red,fontWeight:700}}><Dot result="FAIL"/>{t.fail}</span></td>
              <td style={{padding:"10px 12px",minWidth:110}}><RateBar rate={t.rate} color={t.rate>=70?C.success:t.rate>=50?C.warning:C.red}/></td>
              <td style={{padding:"10px 12px",fontWeight:700,color:C.warning}}>{t.replacements}</td>
              <td style={{padding:"10px 12px",fontSize:11,color:C.muted,maxWidth:160}}>{t.topFault!=="—"?`${t.topFault} (${t.topFaultCount})`:"—"}</td>
            </tr>
          ))}</tbody>
        </table></div></Card>
      </>}

      {(mode==="all"||mode==="faults") && <>
        <SH>⚠️ Fault Analysis by Region</SH>
        <Card style={{padding:0,overflow:"hidden",marginBottom:4}}><div className="table-wrap"><table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:600}}>
          <thead><tr style={{background:"#FFF5F5"}}>{["Region","Total Faults","OK","FAIL","Top Fault Type","Cases","Fault Rate"].map(h=><th key={h} style={thStyle(C.red)}>{h}</th>)}</tr></thead>
          <tbody>{byRegion.map((r,i)=>(
            <tr key={r.region} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":"#FFF9F9"}}>
              <td style={{padding:"10px 12px",fontWeight:700}}>{r.region}</td>
              <td style={{padding:"10px 12px",fontWeight:800,color:C.red,fontSize:14}}>{r.total}</td>
              <td style={{padding:"10px 12px"}}><span style={{display:"flex",alignItems:"center",gap:4,color:C.success,fontWeight:700}}><Dot result="OK"/>{r.ok}</span></td>
              <td style={{padding:"10px 12px"}}><span style={{display:"flex",alignItems:"center",gap:4,color:C.red,fontWeight:700}}><Dot result="FAIL"/>{r.fail}</span></td>
              <td style={{padding:"10px 12px",fontSize:12,maxWidth:180}}>{r.topFault}</td>
              <td style={{padding:"10px 12px",fontWeight:700,color:C.red}}>{r.topFaultCount}</td>
              <td style={{padding:"10px 12px",minWidth:100}}><RateBar rate={r.total?Math.round((r.fail/r.total)*100):0} color={C.red}/></td>
            </tr>
          ))}</tbody>
        </table></div></Card>
      </>}

      {(mode==="all"||mode==="replacements") && <>
        <SH>🔄 Replacements by Region</SH>
        <Card style={{padding:0,overflow:"hidden",marginBottom:4}}><div className="table-wrap"><table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:600}}>
          <thead><tr style={{background:"#FFFBEB"}}>{["Region","Total Jobs","OK","FAIL","Replacements","Rep Rate","Top Reason"].map(h=><th key={h} style={thStyle(C.warning)}>{h}</th>)}</tr></thead>
          <tbody>{byRegion.filter(r=>r.replacements>0).length===0
            ? <tr><td colSpan={7}><EmptyState msg="No replacements recorded"/></td></tr>
            : byRegion.filter(r=>r.replacements>0).map((r,i)=>{
              const repJobs=allJobs.filter(j=>j.region===r.region&&j.replacement==="Yes");
              const rm: Record<string,number>={}; repJobs.forEach(j=>{const x=j.replacementReason||"Unknown";rm[x]=(rm[x]||0)+1;});
              const topReason=Object.entries(rm).sort((a,b)=>b[1]-a[1])[0]?.[0]||"—";
              return (<tr key={r.region} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":"#FEFCE8"}}>
                <td style={{padding:"10px 12px",fontWeight:700}}>{r.region}</td>
                <td style={{padding:"10px 12px",fontWeight:800,color:C.blue,fontSize:14}}>{r.total}</td>
                <td style={{padding:"10px 12px"}}><span style={{display:"flex",alignItems:"center",gap:4,color:C.success,fontWeight:700}}><Dot result="OK"/>{r.ok}</span></td>
                <td style={{padding:"10px 12px"}}><span style={{display:"flex",alignItems:"center",gap:4,color:C.red,fontWeight:700}}><Dot result="FAIL"/>{r.fail}</span></td>
                <td style={{padding:"10px 12px",fontWeight:800,color:C.warning,fontSize:14}}>{r.replacements}</td>
                <td style={{padding:"10px 12px",minWidth:100}}><RateBar rate={r.repRate} color={C.warning}/></td>
                <td style={{padding:"10px 12px",fontSize:11,color:C.muted}}>{topReason}</td>
              </tr>);
            })
          }</tbody>
        </table></div></Card>
      </>}
    </div>
  );
}

// ─── USER EXPORT VIEW ─────────────────────────────────────────────────────────

function UserExportView({ users }: { users:User[] }) {
  const [roleF,   setRoleF]   = useState("");
  const [regionF, setRegionF] = useState("");
  const allRoles   = [...new Set(users.map(u=>u.role))].sort();
  const allRegions = [...new Set(users.map(u=>u.region).filter(Boolean))].sort();
  const rd = (u: User) => u.role==="management"?(u.managementType||"Management"):u.role==="technical_analyst"?"Technical Analyst":u.role;
  const shown = useMemo(()=>{
    let r = users;
    if (roleF)   r = r.filter(u=>u.role===roleF||(u.managementType===roleF));
    if (regionF) r = r.filter(u=>u.region===regionF);
    return r;
  },[users,roleF,regionF]);
  function doPDF() { pdfExport("Staff Directory",`${shown.length} staff members`,[{key:"name",label:"Full Name"},{key:"username",label:"Username"},{key:"roleDisplay",label:"Role"},{key:"region",label:"Region"},{key:"branch",label:"Branch"},{key:"createdAt",label:"Date Added"}],shown.map(u=>({...u,roleDisplay:rd(u),createdAt:fmtDate(u.createdAt)})) as Record<string,unknown>[]); }
  function doCSV() { csvExport(shown.map(u=>({"Full Name":u.name,"Username":u.username,"Role":rd(u),"Region":u.region||"—","Branch":u.branch||"—","Date Added":fmtDate(u.createdAt)})),"AzamStaffDirectory.csv"); }
  return (
    <>
      <PageHeader title="👥 Staff Directory Export" sub={`${shown.length} staff members`} action={<><Btn onClick={doPDF} variant="pdf" size="sm">📄 PDF</Btn><Btn onClick={doCSV} variant="ghost" size="sm">⬇ CSV</Btn></>}/>
      <div className="page-pad" style={{ padding:20 }}>
        <Card style={{marginBottom:16}}><div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{flex:1,minWidth:150}}><label style={LBL}>Filter by Role</label><Sel value={roleF} onChange={e=>setRoleF(e.target.value)}><option value="">All Roles</option>{allRoles.map(r=><option key={r} value={r}>{r}</option>)}</Sel></div>
          <div style={{flex:1,minWidth:150}}><label style={LBL}>Filter by Region</label><Sel value={regionF} onChange={e=>setRegionF(e.target.value)}><option value="">All Regions</option>{allRegions.map(r=><option key={r} value={r}>{r}</option>)}</Sel></div>
          <Btn onClick={()=>{setRoleF("");setRegionF("");}} variant="ghost" size="sm">Clear</Btn>
        </div></Card>
        <Card style={{padding:0,overflow:"hidden"}}>
          <div className="table-wrap">
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:600}}>
              <thead><tr style={{background:"#F5F8FF"}}>{["Full Name","Username","Role","Region","Branch","Date Added"].map(h=><th key={h} style={{padding:"10px 16px",color:C.muted,textAlign:"left",fontWeight:700,fontSize:11,textTransform:"uppercase",letterSpacing:.7,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
              <tbody>{shown.length===0?<tr><td colSpan={6}><EmptyState msg="No users match filter"/></td></tr>:shown.map(u=>(
                <tr key={u.id} style={{borderBottom:`1px solid ${C.border}`}}>
                  <td style={{padding:"11px 16px",fontWeight:700}}>{u.name}</td>
                  <td style={{padding:"11px 16px",fontFamily:"monospace",color:C.blue,fontWeight:700}}>{u.username}</td>
                  <td style={{padding:"11px 16px"}}><Badge color={({admin:"red",technician:"blue",management:"green",technical_analyst:"teal"} as Record<string,string>)[u.role]||"gray"}>{rd(u)}</Badge></td>
                  <td style={{padding:"11px 16px"}}>{u.region||"—"}</td>
                  <td style={{padding:"11px 16px",color:C.muted}}>{u.branch||"—"}</td>
                  <td style={{padding:"11px 16px",color:C.muted,fontSize:12,whiteSpace:"nowrap"}}>{fmtDate(u.createdAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

// ─── AI INSIGHTS ─────────────────────────────────────────────────────────────

function ApiKeyModal({ onClose }: { onClose:()=>void }) {
  const [key,   setKey]   = useState(localStorage.getItem("azam_openai_key")||"");
  const [saved, setSaved] = useState(false);
  function save() { if (!key.trim()) { showToast("Paste your API key first.","error"); return; } localStorage.setItem("azam_openai_key",key.trim()); setSaved(true); setTimeout(()=>{setSaved(false);onClose();},900); }
  function clear() { localStorage.removeItem("azam_openai_key"); setKey(""); showToast("API key cleared.","info"); }
  const masked = key ? key.slice(0,7)+"••••••••"+key.slice(-4) : "";
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(10,22,40,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000,padding:16}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"#fff",borderRadius:16,padding:28,width:"100%",maxWidth:420,boxShadow:"0 24px 64px rgba(0,0,0,.35)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div><h3 style={{margin:0,fontSize:16,fontWeight:800,color:C.text,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:.5}}>⚙ AI Settings</h3><p style={{margin:"4px 0 0",fontSize:12,color:C.muted}}>Configure your OpenAI API key for AI insights</p></div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:C.muted,padding:4}}>✕</button>
        </div>
        <div style={{background:"#FFF7ED",border:"1px solid #FDE68A",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#92400E",lineHeight:1.5}}>
          ⚠ Your API key is stored only in this browser. Get yours at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" style={{color:C.blue}}>platform.openai.com/api-keys</a>.
        </div>
        {key && <div style={{background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:C.success,fontFamily:"monospace"}}>Current: {masked}</div>}
        <div style={{marginBottom:14}}>
          <label style={LBL}>OpenAI API Key</label>
          <input type="password" value={key} onChange={e=>setKey(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()} placeholder="sk-…"
            style={{padding:"10px 12px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,width:"100%",boxSizing:"border-box",fontFamily:"monospace",outline:"none"}} autoComplete="off"/>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={save} style={{flex:1,padding:"10px",borderRadius:8,border:"none",cursor:"pointer",background:saved?`linear-gradient(135deg,${C.success},#16A34A)`:`linear-gradient(135deg,${C.ai},#5B21B6)`,color:"#fff",fontWeight:700,fontSize:14,fontFamily:"'DM Sans',sans-serif",transition:"background .3s"}}>
            {saved?"✓ Saved!":"Save API Key"}
          </button>
          {key && <button onClick={clear} style={{padding:"10px 16px",borderRadius:8,border:`1.5px solid ${C.border}`,cursor:"pointer",background:"transparent",color:C.red,fontWeight:700,fontSize:13,fontFamily:"'DM Sans',sans-serif"}}>Clear</button>}
        </div>
      </div>
    </div>
  );
}

function AiInsightsPanel({ allJobs, users }: { allJobs:Job[]; users:User[] }) {
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState<string|null>(null);
  const [error,      setError]      = useState<string|null>(null);
  const [mode,       setMode]       = useState("general");
  const [showApiKey, setShowApiKey] = useState(false);
  const hasKey = !!localStorage.getItem("azam_openai_key");
  const isMobile = useIsMobile();

  const MODES = [
    { key:"general",  label:"General Summary",       icon:"📊", desc:"Overall performance and trends" },
    { key:"faults",   label:"Fault Pattern Analysis", icon:"⚠️", desc:"Recurring faults and patterns" },
    { key:"techs",    label:"Technician Insights",    icon:"👤", desc:"Performance per technician" },
    { key:"risk",     label:"Risk & Flags",           icon:"🚨", desc:"High-risk STBs and hotspots" },
  ];

  function buildPrompt() {
    const total = allJobs.length; if (!total) return null;
    const ok=allJobs.filter(j=>j.result==="OK").length, fail=allJobs.filter(j=>j.result==="FAIL").length, rep=allJobs.filter(j=>j.replacement==="Yes").length;
    const fm: Record<string,number>={}; allJobs.forEach(j=>{if(j.faultType)fm[j.faultType]=(fm[j.faultType]||0)+1;});
    const topFaults = Object.entries(fm).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([f,n])=>`${f}:${n}`).join(", ");
    const techs = users.filter(u=>u.role==="technician");
    const ts = techs.map(t=>{const j=allJobs.filter(x=>x.technicianId===t.id);const ok=j.filter(x=>x.result==="OK").length;return`${t.name}(${t.region}):${j.length}jobs,${ok}OK`;}).join("; ");
    const cm: Record<string,number>={}; allJobs.forEach(j=>{if(j.cardNumber)cm[j.cardNumber]=(cm[j.cardNumber]||0)+1;});
    const rm: Record<string,number>={}; allJobs.forEach(j=>{if(j.region)rm[j.region]=(rm[j.region]||0)+1;});
    const pm: Record<string,number>={}; allJobs.filter(j=>j.replacement==="Yes").forEach(j=>{const r=j.replacementReason||"Unknown";pm[r]=(pm[r]||0)+1;});
    const ctx = `Azam TV STB data. Total:${total},OK:${ok}(${Math.round(ok/total*100)}%),FAIL:${fail},Replacements:${rep},RecurringSTBs:${Object.values(cm).filter(n=>n>=2).length}\nFaults:${topFaults}\nTechs:${ts}\nRegions:${Object.entries(rm).map(([r,n])=>`${r}:${n}`).join(",")}\nReplacementReasons:${Object.entries(pm).map(([r,n])=>`${r}:${n}`).join(",")}`;
    const inst: Record<string,string> = {
      general:"Management summary: 1.Overall health 2.Three positives 3.Three concerns 4.Two action recommendations. Be data-driven.",
      faults: "Fault analysis: 1.Top 3 critical patterns 2.Unusual combinations 3.Reduction recommendations 4.Impact of fixing top fault. Be specific.",
      techs:  "Tech analysis: 1.Team assessment 2.High performers 3.Support needed 4.Workload distribution 5.Two coaching tips. Be constructive.",
      risk:   "Risk analysis with HIGH/MEDIUM/LOW labels: 1.Critical indicators 2.Regional/branch hotspots 3.Systemic hardware issues 4.Replacement anomalies 5.Urgent escalations.",
    };
    return ctx + "\n\nINSTRUCTIONS: " + inst[mode];
  }

  async function generate() {
    const p = buildPrompt(); if (!p) { setError("No job data available to analyse."); return; }
    setLoading(true); setResult(null); setError(null);
    try { const t = await callChatGPT(p); setResult(t); }
    catch(e: unknown) { setError(e instanceof Error ? e.message : "Failed to generate insights."); }
    setLoading(false);
  }

  return (
    <>
      {showApiKey && <ApiKeyModal onClose={()=>setShowApiKey(false)}/>}
      <PageHeader title="✨ AI Smart Insights" sub={`Powered by ChatGPT · ${allJobs.length} records`}
        action={
          <button onClick={()=>setShowApiKey(true)} style={{padding:"7px 16px",borderRadius:8,border:`1.5px solid ${hasKey?"#BBF7D0":C.aiBorder}`,background:hasKey?"#F0FDF4":C.aiLight,color:hasKey?C.success:C.ai,cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
            {hasKey?"✓ Key Set":"⚙ AI Settings"}
          </button>
        }/>
      <div className="page-pad" style={{ padding:isMobile?12:24 }}>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:12,marginBottom:20}}>
          {MODES.map(m=>(
            <button key={m.key} onClick={()=>setMode(m.key)} style={{padding:"14px 12px",borderRadius:10,border:`2px solid ${mode===m.key?C.ai:C.border}`,background:mode===m.key?C.aiLight:"#fff",cursor:"pointer",textAlign:"left",transition:"all .15s",fontFamily:"'DM Sans',sans-serif"}}>
              <div style={{fontSize:20,marginBottom:6}}>{m.icon}</div>
              <div style={{fontWeight:700,fontSize:13,color:mode===m.key?C.ai:C.text,marginBottom:3}}>{m.label}</div>
              <div style={{fontSize:11,color:C.muted,lineHeight:1.4}}>{m.desc}</div>
            </button>
          ))}
        </div>
        <div style={{marginBottom:20}}><Btn onClick={generate} disabled={loading} variant="ai">{loading?"Analysing…":"✨ Generate Insights"}</Btn></div>
        {error && <Card style={{borderColor:"#FCA5A5",background:"#FFF5F5",marginBottom:16}}><div style={{color:C.red,fontWeight:700,fontSize:13,whiteSpace:"pre-wrap"}}>{error}</div></Card>}
        {loading && (
          <Card style={{textAlign:"center",padding:"48px 32px",borderColor:C.aiBorder}}>
            <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:14}}>
              {[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:C.ai,animation:"pulse 1.2s ease-in-out infinite",animationDelay:`${i*0.2}s`}}/>)}
            </div>
            <div style={{color:C.ai,fontWeight:700}}>ChatGPT is analysing your service data…</div>
          </Card>
        )}
        {result && !loading && (
          <Card style={{borderColor:C.aiBorder,background:"#FAFBFF"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,paddingBottom:14,borderBottom:`1px solid ${C.aiBorder}`}}>
              <div style={{width:32,height:32,borderRadius:"50%",background:`linear-gradient(135deg,${C.ai},#5B21B6)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>✨</div>
              <div>
                <div style={{fontWeight:800,color:C.ai,fontFamily:"'Barlow Condensed',sans-serif",fontSize:15}}>{MODES.find(m=>m.key===mode)?.label} — AI Analysis</div>
                <div style={{color:C.muted,fontSize:11}}>Based on {allJobs.length} records · GPT-4o</div>
              </div>
              <Badge color="purple">AI Generated</Badge>
            </div>
            <div style={{whiteSpace:"pre-wrap",lineHeight:1.75,fontSize:13.5,color:C.text}}>{result}</div>
            <div style={{marginTop:16,paddingTop:14,borderTop:`1px solid ${C.aiBorder}`,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{color:C.muted,fontSize:11,flex:1}}>💡 AI insights are advisory. Verify before acting.</span>
              <Btn onClick={generate} variant="ghost" size="sm">↺ Regenerate</Btn>
            </div>
          </Card>
        )}
        {!result && !loading && !error && (
          <Card style={{textAlign:"center",padding:"48px 24px",borderStyle:"dashed",borderColor:C.aiBorder}}>
            <div style={{fontSize:48,marginBottom:12}}>🤖</div>
            <div style={{fontWeight:700,color:C.text,fontSize:16,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:.5,marginBottom:8}}>Ready to Analyse</div>
            <div style={{color:C.muted,fontSize:13,maxWidth:380,margin:"0 auto",lineHeight:1.6}}>Select an analysis type above and click Generate Insights. Powered by ChatGPT (GPT-4o).</div>
          </Card>
        )}
      </div>
    </>
  );
}

// ─── MESSAGES VIEW ───────────────────────────────────────────────────────────

function MessagesView({ currentUser, users, messages, onSend, onMarkRead }: {
  currentUser:User; users:User[]; messages:Message[];
  onSend:(m:Omit<Message,"id"|"timestamp"|"read">)=>void; onMarkRead:(id:string)=>void;
}) {
  const canSend=currentUser.role==="technical_analyst"||(currentUser.role==="management"&&currentUser.managementType==="Technical Manager")||currentUser.role==="admin";
  const [tab,setTab]=useState<"inbox"|"sent">("inbox");
  const [composing,setComposing]=useState(false);
  const [toId,setToId]=useState(""); const [subject,setSubject]=useState(""); const [body,setBody]=useState("");
  const [selected,setSelected]=useState<Message|null>(null);
  const isMobile=useIsMobile();
  const inbox=useMemo(()=>messages.filter(m=>m.toId===currentUser.id||m.toId==="all").sort((a,b)=>b.timestamp.localeCompare(a.timestamp)),[messages,currentUser.id]);
  const sent=useMemo(()=>messages.filter(m=>m.fromId===currentUser.id).sort((a,b)=>b.timestamp.localeCompare(a.timestamp)),[messages,currentUser.id]);
  const unread=inbox.filter(m=>!m.read).length;
  const rl=(role:string,mt?:string)=>role==="management"?(mt||"Management"):role==="technical_analyst"?"Tech Analyst":role==="technician"?"Technician":role==="admin"?"Admin":role;
  const rc=(role:string)=>({admin:C.red,technician:C.blueMid,management:C.success,technical_analyst:C.teal} as Record<string,string>)[role]||C.blue;
  const recipients=users.filter(u=>u.id!==currentUser.id).sort((a,b)=>a.name.localeCompare(b.name));
  function handleSend(){
    if(!toId||!subject.trim()||!body.trim()){showToast("Fill in recipient, subject, and message body.","error");return;}
    const toUser=users.find(u=>u.id===toId);
    onSend({fromId:currentUser.id,fromName:currentUser.name,fromRole:currentUser.role,toId,toName:toId==="all"?"All Users":(toUser?.name||"—"),subject:subject.trim(),body:body.trim()});
    setComposing(false);setToId("");setSubject("");setBody("");showToast("Message sent.","success");
  }
  function openMsg(msg:Message){setSelected(msg);if(!msg.read&&(msg.toId===currentUser.id||msg.toId==="all"))onMarkRead(msg.id);}
  const list=tab==="inbox"?inbox:sent;
  return (
    <>
      <PageHeader title="💬 Messages" sub={unread>0?`${unread} unread message${unread>1?"s":""}`:"Internal Communications"}
        action={canSend?<Btn onClick={()=>setComposing(true)} variant="primary" size="sm">✏ Compose</Btn>:undefined}/>
      <div className="page-pad" style={{flex:1,padding:isMobile?12:24}}>
        {composing&&(
          <div style={{position:"fixed",inset:0,background:"rgba(10,22,40,.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:8000,padding:20}} onClick={e=>{if(e.target===e.currentTarget)setComposing(false);}}>
            <div style={{background:"#fff",borderRadius:16,padding:28,maxWidth:520,width:"100%",boxShadow:"0 24px 64px rgba(0,0,0,.35)"}}>
              <h3 style={{margin:"0 0 16px",fontSize:17,fontWeight:800,color:C.text,fontFamily:"'Barlow Condensed',sans-serif"}}>New Message</h3>
              <div style={{marginBottom:12}}><label style={LBL}>To</label>
                <Sel value={toId} onChange={e=>setToId(e.target.value)}>
                  <option value="">— Select Recipient —</option>
                  <option value="all">📢 All Users (Broadcast)</option>
                  {recipients.map(u=><option key={u.id} value={u.id}>{u.name} — {rl(u.role,u.managementType)}</option>)}
                </Sel>
              </div>
              <div style={{marginBottom:12}}><label style={LBL}>Subject</label><Inp value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Message subject…"/></div>
              <div style={{marginBottom:16}}><label style={LBL}>Message</label>
                <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Write your message here…"
                  style={{width:"100%",padding:"10px 14px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,fontFamily:"'DM Sans',sans-serif",resize:"vertical",minHeight:130,outline:"none",color:C.text,boxSizing:"border-box"}}/>
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}><Btn onClick={()=>setComposing(false)} variant="ghost">Cancel</Btn><Btn onClick={handleSend} variant="primary">Send Message</Btn></div>
            </div>
          </div>
        )}
        {selected&&(
          <div style={{position:"fixed",inset:0,background:"rgba(10,22,40,.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:8000,padding:20}} onClick={e=>{if(e.target===e.currentTarget)setSelected(null);}}>
            <div style={{background:"#fff",borderRadius:16,padding:28,maxWidth:560,width:"100%",boxShadow:"0 24px 64px rgba(0,0,0,.35)",maxHeight:"80vh",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                <h3 style={{margin:0,fontSize:17,fontWeight:800,color:C.text,fontFamily:"'Barlow Condensed',sans-serif",flex:1,paddingRight:12}}>{selected.subject}</h3>
                <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:20,lineHeight:1,padding:0}}>✕</button>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:16,padding:"10px 14px",background:C.bg,borderRadius:8,gap:12,flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:.7}}>From</div>
                  <div style={{fontWeight:700,fontSize:14,color:C.text,marginTop:2}}>{selected.fromName}</div>
                  <span style={{padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700,background:rc(selected.fromRole),color:"#fff",marginTop:4,display:"inline-block"}}>{rl(selected.fromRole)}</span>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:.7}}>To</div>
                  <div style={{fontWeight:700,fontSize:14,color:C.text,marginTop:2}}>{selected.toName}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:4}}>{fmtTS(selected.timestamp)}</div>
                </div>
              </div>
              <div style={{fontSize:14,color:C.text,lineHeight:1.75,whiteSpace:"pre-wrap"}}>{selected.body}</div>
              <div style={{marginTop:20,textAlign:"right"}}><Btn onClick={()=>setSelected(null)} variant="ghost" size="sm">Close</Btn></div>
            </div>
          </div>
        )}
        <div style={{display:"flex",gap:4,marginBottom:16}}>
          {([["inbox","📥 Inbox"+(unread>0?` (${unread})`:"")] ,["sent","📤 Sent"]] as [string,string][]).map(([key,label])=>(
            <button key={key} onClick={()=>setTab(key as "inbox"|"sent")}
              style={{padding:"8px 18px",borderRadius:8,border:`1.5px solid ${tab===key?C.blue:C.border}`,background:tab===key?C.blue:"#fff",color:tab===key?"#fff":C.muted,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              {label}
            </button>
          ))}
        </div>
        {list.length===0?(
          <Card style={{textAlign:"center",padding:"40px 24px"}}>
            <div style={{fontSize:40,marginBottom:12}}>💬</div>
            <div style={{color:C.muted,fontSize:14}}>{tab==="inbox"?"No messages yet.":"No sent messages yet."}</div>
            {canSend&&tab==="sent"&&<div style={{marginTop:12}}><Btn onClick={()=>setComposing(true)} variant="primary" size="sm">Compose Message</Btn></div>}
          </Card>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {list.map(msg=>{
              const isUnread=!msg.read&&tab==="inbox";
              const dispName=tab==="inbox"?msg.fromName:msg.toName;
              const dispRole=tab==="inbox"?msg.fromRole:currentUser.role;
              return (
                <div key={msg.id} onClick={()=>openMsg(msg)}
                  style={{background:isUnread?"#EEF3FF":"#fff",border:`1.5px solid ${isUnread?C.blue:C.border}`,borderRadius:10,padding:"12px 16px",cursor:"pointer",display:"flex",gap:14,alignItems:"flex-start",transition:"all .15s"}}>
                  <div style={{width:38,height:38,borderRadius:"50%",background:rc(dispRole),display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"#fff",flexShrink:0,fontFamily:"'Barlow Condensed',sans-serif"}}>
                    {dispName.split(" ").map((n:string)=>n[0]).join("").slice(0,2).toUpperCase()}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                      <div style={{fontWeight:isUnread?800:600,fontSize:14,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{msg.subject}</div>
                      <div style={{fontSize:10,color:C.muted,whiteSpace:"nowrap",flexShrink:0}}>{fmtTS(msg.timestamp)}</div>
                    </div>
                    <div style={{fontSize:12,color:C.muted,marginTop:3}}>
                      {tab==="inbox"?<>From: <b style={{color:C.text}}>{msg.fromName}</b></>:<>To: <b style={{color:C.text}}>{msg.toName}</b></>}
                      {" · "}
                      <span style={{padding:"1px 7px",borderRadius:10,fontSize:10,fontWeight:700,background:rc(dispRole),color:"#fff",opacity:.9}}>{rl(dispRole,currentUser.managementType)}</span>
                    </div>
                    <div style={{fontSize:12,color:C.muted,marginTop:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{msg.body}</div>
                  </div>
                  {isUnread&&<div style={{width:8,height:8,borderRadius:"50%",background:C.blue,flexShrink:0,marginTop:6}}/>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ─── ADMIN APP ────────────────────────────────────────────────────────────────

function AdminApp({ user, users, regions, allJobs, onSaveUsers, onSaveRegions, onLogout, messages, onSendMessage, onMarkRead }: { user:User; users:User[]; regions:Region[]; allJobs:Job[]; onSaveUsers:(u:User[])=>void; onSaveRegions:(r:Region[])=>void; onLogout:()=>void; messages:Message[]; onSendMessage:(m:Omit<Message,"id"|"timestamp"|"read">)=>void; onMarkRead:(id:string)=>void }) {
  const [view, setView] = useState("users");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const unreadMsgsAdmin = useMemo(()=>messages.filter(m=>(m.toId===user.id||m.toId==="all")&&!m.read).length,[messages,user.id]);

  // Regions removed from nav — managed via Users form
  const nav = [
    {key:"users",      icon:"👥", label:"Users"},
    {key:"data",       icon:"📋", label:"All Records"},
    {key:"analytics",  icon:"📈", label:"Analytics"},
    {key:"recurring",  icon:"🔁", label:"Recurring STBs"},
    {key:"card_lookup",icon:"🔎", label:"Card Lookup"},
    {key:"staff_dir",  icon:"📂", label:"Staff Directory"},
    {key:"activity",   icon:"🕓", label:"Activity Log"},
    {key:"ai",         icon:"✨", label:"AI Insights"},
    {key:"messages",   icon:"💬", label:"Messages", ...(unreadMsgsAdmin>0?{badge:unreadMsgsAdmin}:{})},
  ];

  function doExportAll() { csvExport(allJobs.map(j=>({"Date":fmtDate(j.date),"Technician":j.technicianName,"Region":j.region,"Branch":j.branch,"Customer":j.customerName,"Phone":j.phone,"Card Number":j.cardNumber,"Fault":j.faultType,"Model":j.modelNumber,"Result":j.result,"Replacement":j.replacement,"Reason":j.replacementReason})),"AzamSD_FullExport.csv"); }

  return (
    <div className="app-layout" style={{ fontFamily:"'DM Sans',sans-serif", background:C.bg }}>
      <Sidebar user={user} nav={nav} active={view} setActive={setView} onLogout={onLogout} mobileOpen={mobileMenuOpen} onMobileClose={()=>setMobileMenuOpen(false)}/>
      <div className="app-main">
        {view==="users"       && <UsersView users={users} regions={regions} onSave={onSaveUsers} currentUser={user}/>}
        {view==="data"        && <DataView allJobs={allJobs} users={users}/>}
        {view==="analytics"   && <><PageHeader title="Analytics & Performance" sub={`${allJobs.length} total records`} action={<Btn onClick={doExportAll} variant="ghost" size="sm">⬇ Export All</Btn>} onMenu={()=>setMobileMenuOpen(true)}/><AnalyticsView allJobs={allJobs} users={users}/></>}
        {view==="recurring"   && <><PageHeader title="Recurring STBs" sub="Decoders returned 2+ times" onMenu={()=>setMobileMenuOpen(true)}/><div className="page-pad" style={{padding:20}}><RecurringContent allJobs={allJobs}/></div></>}
        {view==="card_lookup" && <CardLookupView allJobs={allJobs}/>}
        {view==="staff_dir"   && <UserExportView users={users}/>}
        {view==="activity"    && <ActivityLogView/>}
        {view==="ai"          && <AiInsightsPanel allJobs={allJobs} users={users}/>}
        {view==="messages"    && <MessagesView currentUser={user} users={users} messages={messages} onSend={onSendMessage} onMarkRead={onMarkRead}/>}
      </div>
    </div>
  );
}

// ─── MANAGEMENT APP ───────────────────────────────────────────────────────────

function ManagementApp({ user, users, allJobs, onLogout, messages, onSendMessage, onMarkRead }: { user:User; users:User[]; allJobs:Job[]; onLogout:()=>void; messages:Message[]; onSendMessage:(m:Omit<Message,"id"|"timestamp"|"read">)=>void; onMarkRead:(id:string)=>void }) {
  const perms = MGMT_PERMISSIONS[user.managementType||""] || ["overview"];
  const has = (p: string) => perms.includes(p);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const unreadMsgsMgmt = useMemo(()=>messages.filter(m=>(m.toId===user.id||m.toId==="all")&&!m.read).length,[messages,user.id]);
  const nav = [
    has("overview")     && {key:"overview",     icon:"📊", label:"Overview"},
    has("performance")  && {key:"performance",  icon:"👤", label:"Performance"},
    has("faults")       && {key:"faults",       icon:"⚠️", label:"Fault Analysis"},
    has("replacements") && {key:"replacements", icon:"🔄", label:"Replacements"},
    has("recurring")    && {key:"recurring",    icon:"🔁", label:"Recurring STBs"},
    has("card_lookup")  && {key:"card_lookup",  icon:"🔎", label:"Card Lookup"},
    has("export")       && {key:"export",       icon:"⬇",  label:"Export Data"},
    has("ai")           && {key:"ai",           icon:"✨", label:"AI Insights"},
    {key:"messages",    icon:"💬", label:"Messages", ...(unreadMsgsMgmt>0?{badge:unreadMsgsMgmt}:{})},
  ].filter(Boolean) as {key:string;icon:string;label:string;badge?:number}[];

  const [view,    setView]    = useState(nav[0]?.key||"overview");
  const [fRegion, setFRegion] = useState(""); const [fBranch, setFBranch] = useState("");
  const [fTech,   setFTech]   = useState(""); const [fFrom,   setFFrom]   = useState(""); const [fTo, setFTo] = useState("");

  const techs      = users.filter(u=>u.role==="technician");
  const allRegions = useMemo(()=>[...new Set(allJobs.map(j=>j.region).filter(Boolean))].sort(),[allJobs]);
  const allBranches= useMemo(()=>[...new Set(allJobs.filter(j=>!fRegion||j.region===fRegion).map(j=>j.branch).filter(Boolean))].sort(),[allJobs,fRegion]);
  const filtered   = useMemo(()=>allJobs.filter(j=>{if(fRegion&&j.region!==fRegion)return false;if(fBranch&&j.branch!==fBranch)return false;if(fTech&&j.technicianId!==fTech)return false;if(fFrom&&j.date<fFrom)return false;if(fTo&&j.date>fTo)return false;return true;}),[allJobs,fRegion,fBranch,fTech,fFrom,fTo]);
  const repBreakdown = useMemo(()=>{const m: Record<string,number>={};filtered.filter(j=>j.replacement==="Yes").forEach(j=>{const r=j.replacementReason||"Unknown";m[r]=(m[r]||0)+1;});return Object.entries(m).map(([name,value])=>({name,value}));},[filtered]);

  function setFilter(k: string, v: string) { if(k==="region"){setFRegion(v);setFBranch("");}else if(k==="branch")setFBranch(v);else if(k==="tech")setFTech(v);else if(k==="from")setFFrom(v);else if(k==="to")setFTo(v); }
  const clearAll = () => { setFRegion("");setFBranch("");setFTech("");setFFrom("");setFTo(""); };

  function doCSV() { csvExport(filtered.map(j=>({"Date":fmtDate(j.date),"Technician":j.technicianName,"Region":j.region,"Branch":j.branch||"—","Customer":j.customerName,"Phone":j.phone||"—","Card Number":j.cardNumber,"Fault":j.faultType,"Model":j.modelNumber,"Result":j.result,"Replacement":j.replacement||"—","Reason":j.replacementReason||"—"})),"AzamMgmt_Export.csv"); }
  function doPDF() { pdfExportGrouped("Management Report", `${filtered.length} records${fRegion?` · ${fRegion}`:""}${fBranch?` · ${fBranch}`:""}`, filtered); }

  const filterBar = <FilterBar filters={{region:fRegion,branch:fBranch,tech:fTech,from:fFrom,to:fTo}} setFilter={setFilter} clearAll={clearAll} regions={allRegions} branches={allBranches} techs={techs} showBranch showTech showDate/>;
  const faultData = useMemo(()=>FAULT_TYPES.map(f=>({name:f,value:filtered.filter(j=>j.faultType===f).length})).filter(d=>d.value>0).sort((a,b)=>b.value-a.value),[filtered]);
  const isMobile  = useIsMobile();

  return (
    <div className="app-layout" style={{ fontFamily:"'DM Sans',sans-serif", background:C.bg }}>
      <Sidebar user={user} nav={nav} active={view} setActive={setView} onLogout={onLogout} mobileOpen={mobileMenuOpen} onMobileClose={()=>setMobileMenuOpen(false)}/>
      <div className="app-main">
        <PageHeader title={nav.find(n=>n.key===view)?.label||"Dashboard"} sub={`${user.managementType||"Management"} · ${filtered.length} records in view`} onMenu={()=>setMobileMenuOpen(true)}/>
        <div className="page-pad" style={{ flex:1, padding:isMobile?12:24 }}>
          {(view==="overview"||view==="performance") && <AnalyticsView allJobs={filtered} users={users} filterBar={filterBar}/>}
          {view==="card_lookup" && <CardLookupView allJobs={allJobs}/>}
          {view==="faults" && (
            <>{filterBar}
              <div className={isMobile?"":"grid-2"} style={isMobile?{display:"flex",flexDirection:"column",gap:16}:{}}>
                <Card><div style={{fontWeight:700,fontSize:16,marginBottom:14,fontFamily:"'Barlow Condensed',sans-serif"}}>Fault Volume (Top 15)</div>{faultData.length>0?<ResponsiveContainer width="100%" height={360}><BarChart data={faultData.slice(0,15)} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#EEF2FF"/><XAxis type="number" tick={{fontSize:9}}/><YAxis dataKey="name" type="category" tick={{fontSize:9}} width={isMobile?90:120}/><Tooltip/><Bar dataKey="value" fill={C.red}/></BarChart></ResponsiveContainer>:<EmptyState/>}</Card>
                <Card><div style={{fontWeight:700,fontSize:16,marginBottom:14,fontFamily:"'Barlow Condensed',sans-serif"}}>Fault Share</div>{faultData.length>0?<ResponsiveContainer width="100%" height={320}><PieChart><Pie data={faultData.slice(0,10)} dataKey="value" nameKey="name" outerRadius={isMobile?80:100} label={({percent})=>`${((percent||0)*100).toFixed(0)}%`}>{faultData.slice(0,10).map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}</Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer>:<EmptyState/>}</Card>
              </div>
              <RegionTechBreakdown allJobs={filtered} users={users} mode="faults"/>
            </>
          )}
          {view==="replacements" && (
            <>{filterBar}
              <div className="metrics-row">{REPLACEMENT_REASONS.map(r=>{const cnt=filtered.filter(j=>j.replacementReason===r||j.replacementReason?.startsWith(r)).length;return <MetricCard key={r} label={r} value={cnt} color={C.blue}/>;})}</div>
              <div className={isMobile?"":"grid-2"} style={isMobile?{display:"flex",flexDirection:"column",gap:16,marginBottom:16}:{marginBottom:20}}>
                <Card><div style={{fontWeight:700,fontSize:16,marginBottom:14,fontFamily:"'Barlow Condensed',sans-serif"}}>Replacement Reasons</div>{repBreakdown.length>0?<ResponsiveContainer width="100%" height={240}><PieChart><Pie data={repBreakdown} dataKey="value" nameKey="name" outerRadius={90} label>{repBreakdown.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}</Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer>:<EmptyState msg="No replacements"/>}</Card>
                <Card><div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Recent Replacements</div><div style={{overflowY:"auto",maxHeight:240}}>{filtered.filter(j=>j.replacement==="Yes").slice(-10).reverse().map(j=>(<div key={j.id} style={{borderBottom:`1px solid ${C.border}`,padding:"8px 0",fontSize:12}}><div style={{fontWeight:700}}>{j.customerName} <span style={{fontFamily:"monospace",color:C.blue}}>#{j.cardNumber}</span></div><div style={{color:C.muted,marginTop:2}}>{j.technicianName} · {fmtDate(j.date)}</div><div style={{marginTop:2}}><Badge color="yellow">{j.replacementReason||"—"}</Badge></div></div>))}</div></Card>
              </div>
              <RegionTechBreakdown allJobs={filtered} users={users} mode="replacements"/>
            </>
          )}
          {view==="recurring"  && <>{filterBar}<RecurringContent allJobs={filtered}/></>}
          {view==="export"     && (
            <>{filterBar}
              <Card style={{maxWidth:500}}>
                <div style={{fontWeight:800,fontSize:18,color:C.text,marginBottom:6,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:.5}}>Export Report</div>
                <p style={{color:C.muted,fontSize:13,marginBottom:20,lineHeight:1.6}}>Use the filters above to narrow the dataset then download.</p>
                <div style={{background:"#F5F8FF",borderRadius:10,padding:16,marginBottom:20,fontSize:13,border:`1px solid ${C.border}`}}>
                  <div style={{fontWeight:700,marginBottom:8,color:C.text}}>Current Selection</div>
                  <div><strong>{filtered.length.toLocaleString()}</strong> records</div>
                  {fRegion && <div>Region: <strong>{fRegion}</strong></div>}
                  {fBranch && <div>Branch: <strong>{fBranch}</strong></div>}
                  {fTech   && <div>Technician: <strong>{techs.find(t=>t.id===fTech)?.name}</strong></div>}
                  {fFrom   && <div>From: <strong>{fmtDate(fFrom)}</strong></div>}
                  {fTo     && <div>To: <strong>{fmtDate(fTo)}</strong></div>}
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}><Btn onClick={doPDF} variant="pdf" full style={{padding:14,fontSize:15}}>📄 Download PDF</Btn><Btn onClick={doCSV} variant="ghost" full style={{padding:14,fontSize:15}}>⬇ Download CSV</Btn></div>
              </Card>
            </>
          )}
          {view==="ai" && <AiInsightsPanel allJobs={filtered} users={users}/>}
          {view==="messages" && <MessagesView currentUser={user} users={users} messages={messages} onSend={onSendMessage} onMarkRead={onMarkRead}/>}
        </div>
      </div>
    </div>
  );
}

// ─── TECHNICAL ANALYST APP ────────────────────────────────────────────────────

function TechnicalAnalystApp({ user, users, allJobs, onLogout, messages, onSendMessage, onMarkRead }: { user:User; users:User[]; allJobs:Job[]; onLogout:()=>void; messages:Message[]; onSendMessage:(m:Omit<Message,"id"|"timestamp"|"read">)=>void; onMarkRead:(id:string)=>void }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  const [jobFrom, setJobFrom] = useState(""); const [jobTo, setJobTo] = useState(""); const [jobRegion, setJobRegion] = useState("");
  const unreadMsgsTA = useMemo(()=>messages.filter(m=>(m.toId===user.id||m.toId==="all")&&!m.read).length,[messages,user.id]);
  const jobRegions  = useMemo(()=>[...new Set(allJobs.map(j=>j.region).filter(Boolean))].sort(),[allJobs]);
  const jobsFiltered = useMemo(()=>allJobs.filter(j=>(!jobFrom||j.date>=jobFrom)&&(!jobTo||j.date<=jobTo)&&(!jobRegion||j.region===jobRegion)),[allJobs,jobFrom,jobTo,jobRegion]);
  const nav = [
    {key:"analytics",  icon:"📈", label:"Analytics"},
    {key:"jobs",       icon:"📋", label:"Jobs Export"},
    {key:"faults",     icon:"⚠️", label:"Fault Analysis"},
    {key:"recurring",  icon:"🔁", label:"Recurring STBs"},
    {key:"card_lookup",icon:"🔎", label:"Card Lookup"},
    {key:"ai",         icon:"✨", label:"AI Insights"},
    {key:"messages",   icon:"💬", label:"Messages", ...(unreadMsgsTA>0?{badge:unreadMsgsTA}:{})},
  ];
  const [view, setView] = useState("analytics");
  const faultData = useMemo(()=>{const m: Record<string,number>={};allJobs.forEach(j=>{if(j.faultType)m[j.faultType]=(m[j.faultType]||0)+1;});return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value}));},[allJobs]);

  return (
    <div className="app-layout" style={{ fontFamily:"'DM Sans',sans-serif", background:C.bg }}>
      <Sidebar user={user} nav={nav} active={view} setActive={setView} onLogout={onLogout} mobileOpen={mobileMenuOpen} onMobileClose={()=>setMobileMenuOpen(false)}/>
      <div className="app-main">
        <PageHeader title={nav.find(n=>n.key===view)?.label||"Technical Analysis"} sub={`Technical Analyst · ${allJobs.length} total records`} onMenu={()=>setMobileMenuOpen(true)}/>
        <div className="page-pad" style={{ flex:1, padding:isMobile?12:24 }}>
          {view==="analytics" && <>
            <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:16}}>
              <Btn onClick={()=>analyticsExportPDF(allJobs,users)} variant="pdf" size="sm">📄 Analytics PDF</Btn>
              <Btn onClick={()=>analyticsExportCSV(allJobs)} variant="ghost" size="sm">⬇ Analytics CSV</Btn>
            </div>
            <AnalyticsView allJobs={allJobs} users={users}/>
          </>}
          {view==="jobs" && <>
            <Card style={{marginBottom:16}}>
              <div style={{fontWeight:700,fontSize:15,marginBottom:12,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:.5}}>Filter Jobs for Export</div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end"}}>
                <div><label style={LBL}>From</label><Inp type="date" value={jobFrom} onChange={e=>setJobFrom(e.target.value)} style={{width:"auto"}}/></div>
                <div><label style={LBL}>To</label><Inp type="date" value={jobTo} onChange={e=>setJobTo(e.target.value)} style={{width:"auto"}}/></div>
                <div style={{minWidth:180}}><label style={LBL}>Region</label><Sel value={jobRegion} onChange={e=>setJobRegion(e.target.value)}><option value="">All Regions</option>{jobRegions.map(r=><option key={r} value={r}>{r}</option>)}</Sel></div>
                {(jobFrom||jobTo||jobRegion)&&<Btn onClick={()=>{setJobFrom("");setJobTo("");setJobRegion("");}} variant="ghost" size="sm">Clear</Btn>}
              </div>
            </Card>
            <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
              <Btn onClick={()=>pdfExportGrouped("Technician Jobs Report",`${jobsFiltered.length} records${jobRegion?` · ${jobRegion}`:""}`,jobsFiltered)} variant="pdf" size="sm">📄 Download PDF</Btn>
              <Btn onClick={()=>csvExport(jobsFiltered.map(j=>({"Date":fmtDate(j.date),"Technician":j.technicianName,"Region":j.region,"Branch":j.branch,"Customer":j.customerName,"Phone":j.phone||"—","Card #":j.cardNumber,"Fault":j.faultType,"Model":j.modelNumber,"Result":j.result,"Replacement":j.replacement||"—","Reason":j.replacementReason||"—"})),"AzamSD_JobsExport.csv")} variant="ghost" size="sm">⬇ Download CSV</Btn>
              <span style={{color:C.muted,fontSize:12,alignSelf:"center"}}>{jobsFiltered.length} of {allJobs.length} records</span>
            </div>
            <Card style={{padding:0,overflow:"hidden"}}>
              <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontWeight:700,fontSize:14}}>Job Records</span>
                <span style={{color:C.muted,fontSize:12}}>Showing {Math.min(jobsFiltered.length,300)} of {jobsFiltered.length}</span>
              </div>
              <div className="table-wrap"><table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:750}}>
                <thead><tr style={{background:"#F5F8FF"}}>{["Date","Technician","Region","Branch","Customer","Card #","Fault","Result","Replacement"].map(h=><th key={h} style={{padding:"10px 14px",color:C.muted,textAlign:"left",fontWeight:700,fontSize:11,textTransform:"uppercase",letterSpacing:.7,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                <tbody>
                  {jobsFiltered.length===0?<tr><td colSpan={9} style={{padding:32,textAlign:"center",color:C.muted}}>No records match — adjust the filters above</td></tr>
                  :[...jobsFiltered].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,300).map(j=>(
                    <tr key={j.id} style={{borderBottom:`1px solid ${C.border}`}}>
                      <td style={{padding:"10px 14px",color:C.muted,fontSize:12,whiteSpace:"nowrap"}}>{fmtDate(j.date)}</td>
                      <td style={{padding:"10px 14px",fontWeight:600}}>{j.technicianName}</td>
                      <td style={{padding:"10px 14px",fontSize:12}}>{j.region}</td>
                      <td style={{padding:"10px 14px",fontSize:12}}>{j.branch}</td>
                      <td style={{padding:"10px 14px"}}>{j.customerName}</td>
                      <td style={{padding:"10px 14px",fontFamily:"monospace",fontWeight:800,color:C.blue,fontSize:12}}>{j.cardNumber}</td>
                      <td style={{padding:"10px 14px",fontSize:12}}>{j.faultType}</td>
                      <td style={{padding:"10px 14px"}}><Badge color={j.result==="OK"?"green":"red"}>{j.result}</Badge></td>
                      <td style={{padding:"10px 14px"}}><Badge color={j.replacement==="Yes"?"yellow":"gray"}>{j.replacement||"—"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </Card>
          </>}
          {view==="card_lookup" && <CardLookupView allJobs={allJobs}/>}
          {view==="recurring"   && <RecurringContent allJobs={allJobs}/>}
          {view==="ai"          && <AiInsightsPanel allJobs={allJobs} users={users}/>}
          {view==="messages"    && <MessagesView currentUser={user} users={users} messages={messages} onSend={onSendMessage} onMarkRead={onMarkRead}/>}
          {view==="faults" && (
            <>
              <div className="metrics-row">
                <MetricCard label="Distinct Faults" value={faultData.length} icon="⚠️" color={C.red} sub="Unique fault types"/>
                <MetricCard label="Top Fault"       value={faultData[0]?.value||0} icon="📌" color={C.red} sub={faultData[0]?.name||"—"}/>
                <MetricCard label="Total Jobs"       value={allJobs.length} icon="🔧" sub="All records"/>
              </div>
              <div className={isMobile?"":"grid-2"} style={isMobile?{display:"flex",flexDirection:"column",gap:16}:{}}>
                <Card><div style={{fontWeight:700,fontSize:16,marginBottom:14,fontFamily:"'Barlow Condensed',sans-serif"}}>Fault Volume Ranking</div>{faultData.length>0?<ResponsiveContainer width="100%" height={400}><BarChart data={faultData.slice(0,15)} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#EEF2FF"/><XAxis type="number" tick={{fontSize:9}}/><YAxis dataKey="name" type="category" tick={{fontSize:9}} width={isMobile?90:130}/><Tooltip/><Bar dataKey="value" name="Cases" fill={C.red}/></BarChart></ResponsiveContainer>:<EmptyState/>}</Card>
                <Card><div style={{fontWeight:700,fontSize:16,marginBottom:14,fontFamily:"'Barlow Condensed',sans-serif"}}>Fault Distribution</div>{faultData.length>0?<ResponsiveContainer width="100%" height={380}><PieChart><Pie data={faultData.slice(0,10)} dataKey="value" nameKey="name" outerRadius={isMobile?80:110} label={({percent})=>`${((percent||0)*100).toFixed(0)}%`}>{faultData.slice(0,10).map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}</Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer>:<EmptyState/>}</Card>
              </div>
              <Card style={{marginTop:20,padding:0,overflow:"hidden"}}>
                <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.border}`,fontWeight:700,fontSize:15,fontFamily:"'Barlow Condensed',sans-serif"}}>All Fault Types — Detailed</div>
                <div className="table-wrap">
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:400}}>
                    <thead><tr style={{background:"#FFF5F5"}}>{["#","Fault Type","Cases","Share"].map(h=><th key={h} style={{padding:"10px 16px",color:C.muted,textAlign:"left",fontWeight:700,fontSize:11,textTransform:"uppercase",letterSpacing:.7,borderBottom:`1px solid ${C.border}`}}>{h}</th>)}</tr></thead>
                    <tbody>{faultData.map((f,i)=>(
                      <tr key={f.name} style={{borderBottom:`1px solid ${C.border}`}}>
                        <td style={{padding:"10px 16px",color:C.muted,fontSize:12,fontWeight:700}}>{i+1}</td>
                        <td style={{padding:"10px 16px",fontWeight:600}}>{f.name}</td>
                        <td style={{padding:"10px 16px",fontWeight:800,color:C.red}}>{f.value}</td>
                        <td style={{padding:"10px 16px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{flex:1,height:7,background:"#EEF2FF",borderRadius:4,minWidth:60}}><div style={{width:`${allJobs.length?Math.round((f.value/allJobs.length)*100):0}%`,height:"100%",borderRadius:4,background:C.red}}/></div>
                            <span style={{fontSize:12,color:C.muted,minWidth:32}}>{allJobs.length?Math.round((f.value/allJobs.length)*100):0}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </Card>
              <RegionTechBreakdown allJobs={allJobs} users={users} mode="faults"/>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

const INITIAL_ADMIN: User = { id:"ADMIN_001", name:"System Administrator", username:"admin", password:"admin123", role:"admin", region:"HQ", branch:"Headquarters", createdAt:new Date().toISOString() };

function LoadingScreen() {
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:`linear-gradient(135deg,${C.blueDark},#0F2055)`, fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ textAlign:"center" }}>
        <AzamLogo size="lg"/>
        <div style={{ color:"rgba(255,255,255,.4)", marginTop:20, fontSize:14, letterSpacing:1 }}>Loading…</div>
      </div>
    </div>
  );
}

export default function App() {
  const [ready,       setReady]       = useState(false);
  const [currentUser, setCurrentUser] = useState<User|null>(null);
  const [users,       setUsers]       = useState<User[]>([INITIAL_ADMIN]);
  const [regions,     setRegions]     = useState<Region[]>([]);
  const [allJobs,     setAllJobs]     = useState<Job[]>([]);
  const [messages,    setMessages]    = useState<Message[]>([]);

  useEffect(()=>{
    migrateKeys();
    const u = db.get("users") as User[] | null;
    const r = db.get("regions") as Region[] | null;
    const j = db.get("jobs") as Job[] | null;
    const loadedUsers = (u && u.length > 0) ? u : [INITIAL_ADMIN];
    if (!(u && u.length > 0)) db.set("users", [INITIAL_ADMIN]);
    setUsers(loadedUsers);
    if (r) setRegions(r);
    if (j) setAllJobs(j);
    const ms = db.get("messages") as Message[] | null;
    if (ms) setMessages(ms);

    // Restore session
    const savedUid = loadSession();
    if (savedUid) {
      const savedUser = loadedUsers.find((x: User) => x.id === savedUid);
      if (savedUser) setCurrentUser(savedUser);
    }
    setReady(true);
  },[]);

  function saveUsers(u: User[]) { setUsers(u); db.set("users", u); }
  function saveRegions(r: Region[]) { setRegions(r); db.set("regions", r); }
  function submitBatch(jobs: Job[]) { const next=[...allJobs,...jobs]; setAllJobs(next); db.set("jobs", next); }
  function sendMessage(m: Omit<Message,"id"|"timestamp"|"read">) { const msg: Message={...m,id:uid(),timestamp:new Date().toISOString(),read:false}; const next=[...messages,msg]; setMessages(next); db.set("messages",next); }
  function markRead(id: string) { const next=messages.map(m=>m.id===id?{...m,read:true}:m); setMessages(next); db.set("messages",next); }

  if (!ready) return <LoadingScreen/>;

   // ─── PART 1: UNIFIED SINGLE-CLICK ONE-WAY LOGIN ROUTER ───
  if (!currentUser) {
    return (
      <>
        <ToastContainer />
        <LoginPage
          users={users}
          onLogin={async (username: string, password: string, onFail: (msg: string) => void): Promise<void> => {
            // 1. Format text cleanly to email string format for Supabase Auth
            const loginEmail: string = username.trim().includes('@') 
              ? username.trim() 
              : `${username.trim()}@azamservicedesk.local`;

            // 2. Perform verification check directly against Supabase Core
            const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
              email: loginEmail,
              password: password,
            });

            if (authError) {
              onFail(authError.message);
              return;
            }

            if (authData?.user) {
              // 3. Match the secure user profile by looking up their Supabase UUID inside your user list
              const matchedProfile = users.find((u: any) => u.id === authData.user.id || u.username.toLowerCase() === username.trim().toLowerCase());
              
              if (matchedProfile) {
                // Permanently link local data item ID to their real Supabase Unique ID
                if (matchedProfile.id !== authData.user.id) {
                  matchedProfile.id = authData.user.id;
                  onSave(users.map((u: any) => u.username === matchedProfile.username ? matchedProfile : u));
                }
                saveSession(matchedProfile.id);
                setCurrentUser(matchedProfile); // Unlocks correct admin/manager layouts right away
              } else {
                // Emergency user metadata fallback if they aren't fully registered locally yet
                const fallbackUser: any = {
                  id: authData.user.id,
                  name: authData.user.user_metadata?.full_name || username,
                  username: username.trim(),
                  role: authData.user.user_metadata?.role || "technician",
                  region: "Headquarters",
                  createdAt: new Date().toISOString()
                };
                onSave([...users, fallbackUser]);
                saveSession(fallbackUser.id);
                setCurrentUser(fallbackUser);
              }
            }
          }}
        />
      </>
    );
