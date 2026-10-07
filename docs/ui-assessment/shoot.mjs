// screenshots for the UI assessment: node shoot.mjs <which>   which = ep | oh | shiny
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const which = process.argv[2];
const VP = { phone: { width: 390, height: 844 }, laptop: { width: 1280, height: 800 }, projector: { width: 1920, height: 1080 } };
const EP = "https://oceanmetrics.io/erddap-places/";
const OH = "https://oceanmetrics.io/obis-hex/";
const HOME = process.env.HOME;
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

async function shot({ url, file, vp, ready, full = false, after }) {
  const ctx = await b.newContext({ viewport: VP[vp], deviceScaleFactor: 1, isMobile: vp === "phone", hasTouch: vp === "phone" });
  const p = await ctx.newPage();
  const t0 = Date.now();
  await p.goto(url, { waitUntil: "domcontentloaded" });
  let note = "";
  try { note = await ready(p); } catch (e) { note = "READY TIMEOUT: " + e.message.split("\n")[0]; }
  await p.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(2000);
  if (after) await after(p);
  await p.screenshot({ path: file, fullPage: full });
  console.log(`${file} [${((Date.now() - t0) / 1000).toFixed(1)} s] ${note}`);
  await ctx.close();
}

const epStats = async (p) => {
  await p.waitForFunction(() => /^(done|.*error)/i.test(document.querySelector(".status")?.textContent ?? "") || document.querySelector(".status.err"), null, { timeout: 180000 });
  return await p.locator(".status").innerText();
};
const epTN = async (p) => {
  await p.waitForFunction(() => {
    const s = document.querySelector(".status")?.textContent ?? "";
    const f = document.querySelector("footer")?.textContent ?? "";
    return (/vs Now/.test(s) && !s.endsWith("…") && /request/.test(f) && document.querySelector(".chart svg")) || /failed/.test(s);
  }, null, { timeout: 180000 });
  return (await p.locator(".status").innerText()) + " || " + (await p.locator("footer").innerText());
};
const ohReady = async (p) => {
  await p.waitForSelector('.shell[data-ready="1"]', { timeout: 180000 });
  await p.waitForFunction(() => /ms/.test(document.querySelector("footer.foot")?.textContent ?? ""), null, { timeout: 60000 });
  return (await p.locator(".stats .title").innerText()) + " || " + (await p.locator("footer.foot").innerText()).replace(/\n/g, " | ");
};
const shinyReady = async (p) => {
  await p.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  await p.waitForFunction(() => !document.documentElement.classList.contains("shiny-busy"), null, { timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(45000); // the nms-cc leaflet map needs ~40 s to draw
  return await p.title();
};

if (which === "ep") {
  const out = `${HOME}/Github/oceanmetrics/erddap-places/docs/ui-assessment`; mkdirSync(out, { recursive: true });
  const states = [
    ["stats_initial", EP],
    ["stats_fknms-sst", `${EP}#place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST`],
    ["thennow_fknms", `${EP}#mode=then-now`],
  ];
  for (const [name, url] of states) for (const vp of Object.keys(VP)) {
    const ready = name.startsWith("thennow") ? epTN : epStats;
    await shot({ url, vp, ready, file: `${out}/${name}_${vp}.png` });
    if (vp !== "projector") await shot({ url, vp, ready, full: true, file: `${out}/${name}_${vp}_fullpage.png` });
  }
  await shot({ url: `${EP}#mode=then-now&anom=1`, vp: "laptop", ready: epTN, full: true, file: `${out}/thennow_fknms-anomaly_laptop_fullpage.png` });
}
if (which === "oh") {
  const out = `${HOME}/Github/oceanmetrics/obis-hex/docs/ui-assessment`; mkdirSync(out, { recursive: true });
  const states = [
    ["initial", (t) => (t === "dark" ? OH : `${OH}#t=light`)],
    ["eov-seabirds_res3", (t) => `${OH}#i=es&l=eov:seabirds&p=all&r=3&o=0.85&t=${t}&d=release&g=flat&c=-20,5,1.4`],
    ["aves_res7_monterey", (t) => `${OH}#i=es&l=taxon:class:Aves&p=all&r=7&o=0.85&t=${t}&d=release&g=flat&c=-122.05,36.75,9.2`],
    ["eov-seabirds_globe", (t) => `${OH}#i=es&l=eov:seabirds&p=all&r=2&o=0.85&t=${t}&d=release&g=globe&c=-150,20,1.6`],
  ];
  for (const [name, u] of states) for (const t of ["dark", "light"]) for (const vp of Object.keys(VP))
    await shot({ url: u(t), vp, ready: ohReady, full: vp === "phone", file: `${out}/${name}_${t}_${vp}.png` });
}
if (which === "shiny") {
  for (const [repo, name, url] of [
    ["obis-hex", "shiny_h3-db", "https://app.marinesensitivity.org/h3-db/"],
    ["erddap-places", "shiny_nms-cc", "https://shiny.marinebon.app/nms-cc/"],
  ]) {
    const out = `${HOME}/Github/oceanmetrics/${repo}/docs/ui-assessment`; mkdirSync(out, { recursive: true });
    await shot({ url, vp: "laptop", ready: shinyReady, file: `${out}/${name}_laptop.png` });
    await shot({ url, vp: "laptop", ready: shinyReady, full: true, file: `${out}/${name}_laptop_fullpage.png` });
  }
}
await b.close();
