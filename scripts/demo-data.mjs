#!/usr/bin/env node
/**
 * Demo data for checking every page, created through the REAL API (so all
 * validation, tenant scoping, audit hashing and test-engine rules apply).
 *
 *   npm run demo:data                      # against http://localhost:4000
 *   API_URL=http://localhost:4001 npm run demo:data
 *
 * Creates (once) a company "Demo Lab" and fills it. Safe to re-run: it stops
 * if the company already has projects. Never deletes anything (unlike db:seed).
 *
 * Logins printed at the end. Change SUPER_* env vars if you changed the super admin.
 */
const API = process.env.API_URL ?? "http://localhost:4000";
const SUPER_EMAIL = process.env.SUPER_EMAIL ?? "super@civix.sa";
const SUPER_PASSWORD = process.env.SUPER_PASSWORD ?? "demo1234!";
const SUBDOMAIN = "demo";
const ADMIN = { email: "admin@demo.sa", password: "Demo1234!" };
const USERS = [
  { email: "tech@demo.sa", firstName: "Khalid", lastName: "Technician", role: "Technician" },
  { email: "reviewer@demo.sa", firstName: "Sara", lastName: "Reviewer", role: "Reviewer" },
  { email: "approver@demo.sa", firstName: "Omar", lastName: "Approver", role: "Approver" },
];
const USER_PASSWORD = "Demo1234!";

async function call(method, path, { token, body, allow = [] } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok && !allow.includes(res.status)) {
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return { status: res.status, json };
}

const day = 86_400_000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString();

async function main() {
  console.log(`API: ${API}`);
  const health = await fetch(API + "/health").catch(() => null);
  if (!health?.ok) throw new Error(`API not reachable at ${API}. Start it first (npm run dev).`);

  // 1. Company + admin (super admin)
  const sup = (await call("POST", "/v1/auth/signin", { body: { email: SUPER_EMAIL, password: SUPER_PASSWORD } })).json;
  const created = await call("POST", "/v1/super/tenants", {
    token: sup.token,
    allow: [409],
    body: { name: "Demo Lab", subdomain: SUBDOMAIN, subscriptionTier: "professional", crNumber: "1010123456", vatNumber: "300123456700003", admin: { email: ADMIN.email, firstName: "Demo", lastName: "Admin", password: ADMIN.password } },
  });
  console.log(created.status === 409 ? "Company 'Demo Lab' already exists" : "Created company 'Demo Lab'");

  // 2. Sign in as the company admin
  const step1 = (await call("POST", "/v1/auth/signin", { body: ADMIN })).json;
  const membership = step1.memberships.find((m) => m.subdomain === SUBDOMAIN) ?? step1.memberships[0];
  const token = (await call("POST", "/v1/auth/select-tenant", { token: step1.userToken, body: { tenantId: membership.tenantId } })).json.token;
  const T = { token };

  const existing = (await call("GET", "/v1/operations/projects", T)).json;
  if ((existing.items ?? existing).length > 0) {
    console.log("Demo Lab already has projects; nothing more to create.");
    return printLogins();
  }

  // 3. Master setup
  await call("POST", "/v1/master-setup/departments", { ...T, body: { name: "Concrete & Materials" } });
  await call("POST", "/v1/master-setup/departments", { ...T, body: { name: "Geotechnical" } });
  await call("POST", "/v1/master-setup/laboratories", { ...T, body: { code: "LAB-RYD", name: "Riyadh Central Laboratory", accreditation: "ISO/IEC 17025:2017 (SAAC)", accreditationNumber: "TL-1234", defaultStandardBody: "SASO", reportPrefix: "RPT", sampleCodePrefix: "S", departments: ["Concrete & Materials", "Geotechnical"], disciplines: ["concrete", "soil", "aggregate", "water"] } });
  const clients = [];
  for (const c of [
    { name: "NEOM Company", contactName: "Faisal Al-Harbi", contactEmail: "faisal@neom.example", city: "Tabuk", country: "Saudi Arabia" },
    { name: "Diriyah Gate Development", contactName: "Noura Al-Saud", contactEmail: "noura@diriyah.example", city: "Riyadh", country: "Saudi Arabia" },
  ]) clients.push((await call("POST", "/v1/master-setup/clients", { ...T, body: c })).json);
  for (const e of [
    { name: "Eng. Abdullah Al-Qahtani", email: "abdullah@demo.sa", licenseNumber: "SCE-45521", specialty: "Structural" },
    { name: "Eng. Huda Al-Otaibi", email: "huda@demo.sa", licenseNumber: "SCE-61870", specialty: "Geotechnical" },
  ]) await call("POST", "/v1/master-setup/engineers", { ...T, body: e });

  // 4. Roles, page access, users
  const roleDefs = {
    Technician: { perms: ["test:create", "test:read", "test:update", "test:submit", "sample:create", "sample:read", "project:read", "equipment:read"], pages: ["dashboard", "projects", "samples", "tests", "calendar", "notifications"], edit: ["samples", "tests"] },
    Reviewer: { perms: ["test:read", "test:review", "sample:read", "project:read", "report:read"], pages: ["dashboard", "projects", "samples", "tests", "review", "reports", "calendar"], edit: ["review"] },
    Approver: { perms: ["test:read", "test:approve", "test:sign", "report:read", "report:export"], pages: ["dashboard", "tests", "review", "reports", "audit"], edit: ["review"] },
  };
  for (const [name, d] of Object.entries(roleDefs)) {
    await call("POST", "/v1/admin/roles", { ...T, allow: [409], body: { name, permissions: d.perms } });
    await call("PUT", `/v1/admin/role-permissions/${encodeURIComponent(name)}`, {
      ...T,
      body: { pages: d.pages.map((pageId) => ({ pageId, view: true, create: d.edit.includes(pageId), edit: d.edit.includes(pageId), delete: false })) },
    });
  }
  for (const u of USERS) {
    await call("POST", "/v1/admin/users/invite", { ...T, allow: [409, 402], body: { email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, initialPassword: USER_PASSWORD, department: "Concrete & Materials" } });
  }

  // 5. Projects, samples (spread over 5 months, some with GPS)
  const projectDefs = [
    { projectName: "NEOM Module 4 - Foundations", clientName: clients[0].name, city: "Tabuk", region: "Tabuk", engineerName: "Eng. Abdullah Al-Qahtani", contractValue: 4_200_000, location: "NEOM, Tabuk", gps: "28.1,35.2" },
    { projectName: "Diriyah Gate - Phase 2 Roads", clientName: clients[1].name, city: "Riyadh", region: "Riyadh", engineerName: "Eng. Huda Al-Otaibi", contractValue: 2_750_000, location: "Diriyah, Riyadh", gps: "24.73,46.57" },
    { projectName: "Jeddah Corniche Water Network", clientName: clients[1].name, city: "Jeddah", region: "Makkah", engineerName: "Eng. Abdullah Al-Qahtani", contractValue: 1_300_000, location: "Jeddah Corniche", gps: "21.54,39.17" },
  ];
  const projects = [];
  for (const [i, p] of projectDefs.entries()) {
    const { gps, ...body } = p;
    const proj = (await call("POST", "/v1/operations/projects", { ...T, body: { ...body, startDate: iso(-150 + i * 20), endDate: iso(200), status: "active" } })).json;
    projects.push({ ...proj, gps });
  }
  const sampleTypes = ["concrete", "concrete", "soil", "aggregate", "water", "steel", "cement", "asphalt", "masonry"];
  const samples = [];
  let n = 0;
  for (const proj of projects) {
    for (let k = 0; k < 6; k++) {
      const type = sampleTypes[n % sampleTypes.length];
      const when = -(n * 7 + 2);
      const s = (await call("POST", "/v1/operations/samples", { ...T, body: {
        projectId: proj.id, sampleType: type, sampleDate: iso(when), receivedDate: iso(when + 1),
        sampledBy: "Khalid Technician", sampleLocation: `${proj.city} site ${k + 1}`,
        gpsCoordinates: proj.gps, status: k % 3 === 0 ? "completed" : "in_progress",
        description: `${type} sample ${k + 1} for ${proj.projectName}`,
      } })).json;
      samples.push({ ...s, type, projectId: proj.id, when });
      n++;
    }
  }

  // 6. Equipment (one overdue, one due soon)
  const equipment = [];
  for (const e of [
    { equipmentCode: "EQ-CMP-01", equipmentName: "Compression Testing Machine 2000 kN", manufacturer: "Controls", model: "Automax", serialNumber: "CT-2210", calibrationDueDate: iso(120), status: "active" },
    { equipmentCode: "EQ-NCG-01", equipmentName: "Nuclear Density Gauge", manufacturer: "Troxler", model: "3440", serialNumber: "TX-3440-77", calibrationDueDate: iso(-3), status: "calibration_due" },
    { equipmentCode: "EQ-OVN-01", equipmentName: "Ignition Oven", manufacturer: "InstroTek", model: "IGN-1", serialNumber: "IG-0098", calibrationDueDate: iso(18), status: "active" },
    { equipmentCode: "EQ-SHK-01", equipmentName: "Mechanical Sieve Shaker", manufacturer: "Controls", model: "Sieve-12", serialNumber: "SS-5501", calibrationDueDate: iso(200), status: "active" },
  ]) equipment.push((await call("POST", "/v1/lab/equipment", { ...T, body: { ...e, equipmentType: "testing", calibrationDate: iso(-200) } })).json);

  // 7. Tests: evaluated by the engine, saved with the engine's verdict, then moved through the workflow
  const plans = [
    { code: "A1", type: "concrete", override: { specimenId: "C-101", castingDate: "2026-09-01", testDate: "2026-09-29", maxLoadKn: 900, designStrengthMpa: 35, specimenLoadsKn: [900, 880, 910] } },
    { code: "A1", type: "concrete", override: { specimenId: "C-102", castingDate: "2026-09-01", testDate: "2026-09-29", maxLoadKn: 600, designStrengthMpa: 35, specimenLoadsKn: [600, 640, 620] } },
    { code: "A4", type: "concrete", override: { concreteTemperatureC: 31, ambientTemperatureC: 42, formworkTemperatureC: 38, cementContentKgM3: 350 } },
    { code: "A4", type: "concrete", override: { concreteTemperatureC: 37, ambientTemperatureC: 44, formworkTemperatureC: 40, cementContentKgM3: 380 } },
    { code: "A2", type: "concrete" }, { code: "A8", type: "concrete" }, { code: "A9", type: "concrete" },
    { code: "B3", type: "soil" }, { code: "B7", type: "soil" }, { code: "C3", type: "aggregate" }, { code: "C1", type: "aggregate" },
    { code: "D1", type: "asphalt" }, { code: "E1", type: "steel" }, { code: "F4", type: "cement" }, { code: "G1", type: "masonry" },
    { code: "H1", type: "water", override: { samplingPoint: "Tap 1", sampleType: "tap", ph: 7.4, turbidityNtu: 0.8, colorTcu: 3, tdsMgL: 412, chlorideMgL: 84, sulfateMgL: 96, nitrateMgL: 12, fluorideMgL: 0.6, ironMgL: 0.05, manganeseMgL: 0.02, leadMgL: 0.002, arsenicMgL: 0.001, cadmiumMgL: 0.0005, residualChlorineMgL: 0.32, totalColiformMpn: 0, eColiMpn: 0 } },
    { code: "H1", type: "water", override: { samplingPoint: "Tank 3", sampleType: "tank", ph: 7.0, turbidityNtu: 1.2, colorTcu: 4, tdsMgL: 380, chlorideMgL: 90, sulfateMgL: 80, nitrateMgL: 10, fluorideMgL: 0.5, ironMgL: 0.04, manganeseMgL: 0.02, leadMgL: 0.001, arsenicMgL: 0.001, cadmiumMgL: 0.0005, residualChlorineMgL: 0.3, totalColiformMpn: 0, eColiMpn: 2 } },
  ];
  const results = { pass: 0, fail: 0, skipped: 0 };
  let ti = 0;
  for (const plan of plans) {
    const tpl = (await call("GET", `/v1/operations/test-templates/${plan.code}`, T)).json;
    const input = {};
    for (const f of tpl.fields) {
      if (f.default !== undefined || !f.required) continue;
      input[f.name] = f.type === "number" || f.type === "integer" ? Math.max(f.min ?? 0, 10)
        : f.type === "date" ? "2026-09-01" : f.type === "enum" ? f.options[0] : "demo";
    }
    Object.assign(input, plan.override ?? {});
    const ev = await call("POST", `/v1/operations/test-templates/${plan.code}/evaluate`, { ...T, body: input, allow: [422] });
    if (ev.status === 422) { results.skipped++; console.log(`  skipped ${plan.code}: ${JSON.stringify(ev.json.issues?.[0] ?? ev.json)}`); continue; }
    const sample = samples.find((s) => s.type === plan.type) ?? samples[ti % samples.length];
    const testDay = -(ti * 9 + 1);
    // Same shape the web form saves: a headline number for the list/report views.
    const row = (ev.json.rows ?? []).find((r) => typeof r.value === "number");
    const [k, v] = Object.entries(ev.json.results).find(([, x]) => typeof x === "number") ?? [];
    let primaryResult = row
      ? { value: row.value, unit: row.unit ?? "", label: row.label }
      : k !== undefined ? { value: v, unit: "", label: k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()) } : undefined;
    if (plan.code === "H1") primaryResult = { value: input.tdsMgL, unit: "mg/L", label: "TDS" };
    const body = {
      sampleId: sample.id, projectId: sample.projectId, testType: plan.type, testCode: plan.code,
      standardBody: tpl.standardBody, standardNumber: tpl.standardNumber, testDate: iso(testDay),
      inputData: input, calculatedResults: { ...ev.json.results, ...(primaryResult ? { primaryResult } : {}) },
      passFailStatus: ev.json.overall === "fail" ? "fail" : "pass",
      equipmentId: equipment[ti % equipment.length].id,
    };
    const t = (await call("POST", "/v1/operations/tests", { ...T, body })).json;
    results[body.passFailStatus]++;
    // Workflow variety: draft / submitted / reviewed / approved
    const stage = ti % 4;
    if (stage >= 1) await call("POST", `/v1/operations/tests/${t.id}/submit`, { ...T, body: {} });
    if (stage >= 2) await call("POST", `/v1/operations/tests/${t.id}/review`, { ...T, body: {} });
    if (stage >= 3 && body.passFailStatus === "pass") {
      const ap = await call("POST", `/v1/operations/tests/${t.id}/approve`, { ...T, body: {}, allow: [409] });
      if (ap.status === 409) { results.blocked = (results.blocked ?? 0) + 1; console.log(`  approval blocked for ${plan.code}: ${ap.json?.error?.message}`); }
    }
    ti++;
  }
  console.log(`Created ${projects.length} projects, ${samples.length} samples, ${equipment.length} equipment, ${ti} tests (${results.pass} pass / ${results.fail} fail${results.skipped ? `, ${results.skipped} skipped` : ""}${results.blocked ? `, ${results.blocked} approvals blocked` : ""})`);
  printLogins();
}

function printLogins() {
  console.log("\nLogins (all on company 'Demo Lab'):");
  console.log(`  Company admin : ${ADMIN.email} / ${ADMIN.password}`);
  for (const u of USERS) console.log(`  ${u.role.padEnd(13)}: ${u.email} / ${USER_PASSWORD}`);
  console.log(`  Super admin   : ${SUPER_EMAIL} / ${SUPER_PASSWORD}`);
}

main().catch((e) => { console.error("\nFAILED:", e.message); process.exit(1); });
