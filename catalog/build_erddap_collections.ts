#!/usr/bin/env tsx
// (re)generate the STAC Collections for the datasets re-served on erddap.oceanmetrics.io from the
// USF IMaRS ERDDAP (https://erddap.marine.usf.edu/erddap; config github.com/USF-IMARS/erddap-config),
// straight from each server's own `info/<id>/index.json`: dimensions, variables, units, extents.
//
//   cd precompute && npx tsx ../catalog/build_erddap_collections.ts            # all of them
//   cd precompute && npx tsx ../catalog/build_erddap_collections.ts cmems_biogeochem_phyto
//
// writes catalog/gazetteer/erddap/<id>/{collection.json,README.md,AGENTS.md} and adds a `child` link
// per collection to catalog/gazetteer/catalog.json (once). no dependencies beyond node's fetch.
// a `pending` dataset (not served by erddap.oceanmetrics.io yet) is described from the USF server.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE      = dirname(fileURLToPath(import.meta.url))
const GAZETTEER = resolve(HERE, 'gazetteer')
const BASE      = 'https://erddap.oceanmetrics.io/erddap'
const USF       = 'https://erddap.marine.usf.edu/erddap'
const VERSION   = '2.31.1'
const UPDATED   = new Date().toISOString().slice(0, 10) + 'T00:00:00Z'

// ── providers / licenses ──────────────────────────────────────────────────────
type Provider = { name: string; roles: string[]; url: string }
const CMEMS: Provider = { name: 'Copernicus Marine Service (CMEMS) / Mercator Ocean International', roles: ['producer', 'licensor'], url: 'https://marine.copernicus.eu' }
const NASA_GPM: Provider = { name: 'NASA Global Precipitation Measurement (GPM) mission', roles: ['producer', 'licensor'], url: 'https://gpm.nasa.gov/data/imerg' }
const OSU_VGPM: Provider = { name: 'Oregon State University Ocean Productivity (VGPM, from NASA MODIS-Aqua)', roles: ['producer', 'licensor'], url: 'http://sites.science.oregonstate.edu/ocean.productivity/' }
const NASA_JPL: Provider = { name: 'NASA JPL PO.DAAC', roles: ['producer', 'licensor'], url: 'https://podaac.jpl.nasa.gov' }
// USF serves the source ERDDAP; only one provider may carry 'host' (PTL-PRV-002), and that is us
const USF_HOST: Provider = { name: 'USF Institute for Marine Remote Sensing (IMaRS), source ERDDAP', roles: ['processor'], url: USF }
const OM: Provider       = { name: 'Ocean Metrics LLC', roles: ['processor', 'host'], url: 'https://oceanmetrics.io' }

const CMEMS_LICENSE = { href: 'https://marine.copernicus.eu/user-corner/service-commitments-and-licence', title: 'Copernicus Marine Service licence' }

interface Spec {
  id          : string
  title       : string
  about       : string              // one or two sentences for the description / README
  producer    : Provider
  license     : string              // SPDX or 'other'
  licenseLink?: { href: string; title: string }
  product    ?: { href: string; title: string }  // the producer's own product page
  attribution : string
  status     ?: 'pending'
  note       ?: string              // a caveat, repeated in the description, README and AGENTS
}

const BGC = { href: 'https://doi.org/10.48670/moi-00015', title: 'CMEMS GLOBAL_ANALYSISFORECAST_BGC_001_028' }
const PHY = { href: 'https://doi.org/10.48670/moi-00016', title: 'CMEMS GLOBAL_ANALYSISFORECAST_PHY_001_024' }
const cmems = (id: string, title: string, about: string, product = BGC, note?: string): Spec =>
  ({ id, title, about, producer: CMEMS, license: 'other', licenseLink: CMEMS_LICENSE, product,
     attribution: 'E.U. Copernicus Marine Service Information (CMEMS)', note })

export const SPECS: Spec[] = [
  cmems('CMEMS_PHY_MONTHLY', 'CMEMS Global Ocean Physics — surface salinity (known NaN)',
    'Sea water salinity (so) at the surface level from the CMEMS global ocean physics analysis and forecast.', PHY,
    'Known issue: the values on this dataset are all NaN as re-served (2026-10); use cmems_salinity instead. Not precomputed.'),
  cmems('cmems_salinity', 'CMEMS Global Ocean Physics — monthly salinity (50 depths)',
    'Monthly mean sea water salinity (so) on 50 depth levels from the CMEMS global ocean physics analysis and forecast (1/12 degree).', PHY),
  cmems('cmems_biogeochem_nutrients', 'CMEMS Global Biogeochemistry — monthly nutrients',
    'Monthly mean dissolved iron, nitrate, phosphate and silicate (fe, no3, po4, si) on 50 depth levels from the CMEMS global biogeochemistry analysis and forecast (0.25 degree).'),
  cmems('cmems_biogeochem_phyto', 'CMEMS Global Biogeochemistry — monthly chlorophyll + phytoplankton',
    'Monthly mean total chlorophyll and phytoplankton carbon (chl, phyc) on 50 depth levels from the CMEMS global biogeochemistry analysis and forecast (0.25 degree).'),
  cmems('cmems_biogeochem_pp', 'CMEMS Global Biogeochemistry — monthly primary production + oxygen',
    'Monthly mean net primary production and dissolved oxygen (nppv, o2) on 50 depth levels from the CMEMS global biogeochemistry analysis and forecast (0.25 degree).'),
  cmems('cmems_biogeochem_carbon', 'CMEMS Global Biogeochemistry — monthly carbonate system',
    'Monthly mean dissolved inorganic carbon, pH and total alkalinity (dissic, ph, talk) on 50 depth levels from the CMEMS global biogeochemistry analysis and forecast (0.25 degree).'),
  cmems('cmems_biogeochem_co2', 'CMEMS Global Biogeochemistry — monthly surface pCO2',
    'Monthly mean surface partial pressure of CO2 (spco2) from the CMEMS global biogeochemistry analysis and forecast (0.25 degree).'),
  cmems('cmems_biogeochem_zoo', 'CMEMS Global Biogeochemistry — monthly zooplankton',
    'Monthly mean total zooplankton carbon (zooc) on 50 depth levels from the CMEMS global biogeochemistry analysis and forecast (0.25 degree).'),
  cmems('cmems_biogeochem_optics', 'CMEMS Global Biogeochemistry — monthly light attenuation (Kd)',
    'Monthly mean diffuse attenuation coefficient of light, 400-500 nm (kd), on 50 depth levels from the CMEMS global biogeochemistry analysis and forecast (0.25 degree).'),
  cmems('cmems_altimetry', 'CMEMS Global Ocean Physics — 2-D fields (MLD, bottom T, SSH, sea ice)',
    'Two-dimensional daily-mean fields from the CMEMS global ocean physics analysis and forecast (1/12 degree): mixed layer depth (mlotst), sea bottom temperature (tob) and salinity (sob), sea surface height (zos), sea floor pressure (pbo) and sea ice variables. The re-served time axis is irregular (about every 2-3 days), not monthly.', PHY),
  { id: 'IMERG_monthly_global_precip', title: 'NASA GPM IMERG — monthly global precipitation',
    about: 'Monthly accumulated precipitation from the NASA Global Precipitation Measurement mission IMERG product, 0.1 degree global.',
    producer: NASA_GPM, license: 'CC0-1.0', attribution: 'NASA GPM IMERG',
    product: { href: 'https://gpm.nasa.gov/data/imerg', title: 'NASA GPM IMERG' } },
  { id: 'moda_npp_mo_glob', title: 'MODIS-Aqua net primary productivity (VGPM) — monthly global 9 km',
    about: 'Monthly net primary productivity (npp) from the Vertically Generalized Production Model (VGPM) applied to MODIS-Aqua, Oregon State University Ocean Productivity, 9 km global.',
    producer: OSU_VGPM, license: 'other', attribution: 'Oregon State University Ocean Productivity (Behrenfeld & Falkowski 1997 VGPM; NASA MODIS-Aqua)',
    licenseLink: { href: 'http://sites.science.oregonstate.edu/ocean.productivity/', title: 'Ocean Productivity: free to use with attribution' },
    product: { href: 'http://sites.science.oregonstate.edu/ocean.productivity/', title: 'OSU Ocean Productivity' } },
  { id: 'jplMURSST41mday', title: 'JPL MUR SST v4.1 — monthly mean (pending)',
    about: 'Monthly mean of the JPL MUR (Multi-scale Ultra-high Resolution) SST analysis v4.1, 0.01 degree global.',
    producer: NASA_JPL, license: 'CC0-1.0', attribution: 'JPL MUR SST v4.1 (NASA JPL PO.DAAC)', status: 'pending',
    product: { href: 'https://podaac.jpl.nasa.gov/dataset/MUR-JPL-L4-GLOB-v4.1', title: 'MUR-JPL-L4-GLOB-v4.1' },
    note: 'Pending: not served by erddap.oceanmetrics.io yet (its upstream, NOAA CoastWatch, is down); described from the USF server. Not precomputed.' },
  { id: 'jplMURSST41anom1day', title: 'JPL MUR SST v4.1 — daily anomaly (pending)',
    about: 'Daily sea surface temperature anomaly from the JPL MUR (Multi-scale Ultra-high Resolution) SST analysis v4.1, 0.01 degree global.',
    producer: NASA_JPL, license: 'CC0-1.0', attribution: 'JPL MUR SST v4.1 (NASA JPL PO.DAAC)', status: 'pending',
    product: { href: 'https://podaac.jpl.nasa.gov/dataset/MUR-JPL-L4-GLOB-v4.1', title: 'MUR-JPL-L4-GLOB-v4.1' },
    note: 'Pending: not served by erddap.oceanmetrics.io yet (its upstream, NOAA CoastWatch, is down); described from the USF server. Not precomputed.' },
]

// ── ERDDAP info table ─────────────────────────────────────────────────────────
type Row = string[]
interface Axis { name: string; n: number; spacing: number | null; range: [number, number]; first: number; longName: string; units: string }
interface Info { rows: Row[]; axes: Axis[]; vars: Array<{ name: string; dims: string[]; units: string | null; longName: string }> }

async function info(base: string, id: string): Promise<Info> {
  const res = await fetch(`${base}/info/${id}/index.json`, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`${base}/info/${id}: ${res.status}`)
  const rows: Row[] = (await res.json()).table.rows.map((r: unknown[]) => r.map((c) => (c == null ? '' : String(c))))
  const attr = (v: string, a: string) => rows.find((r) => r[0] === 'attribute' && r[1] === v && r[2] === a)?.[4] ?? ''
  const axes: Axis[] = []
  for (const r of rows.filter((x) => x[0] === 'dimension')) {
    const name = r[1], d = r[4]
    const range = attr(name, 'actual_range').split(',').map((x) => Number(x.trim())) as [number, number]
    const sp  = d.match(/averageSpacing=([^,]+)/)?.[1]?.trim() ?? ''
    const one = d.match(/onlyValue=([-\d.eE]+)/)?.[1]
    const ax: Axis = {
      name, n: Number(d.match(/nValues=(\d+)/)?.[1] ?? 1), spacing: /^-?[\d.eE]+$/.test(sp) ? Number(sp) : null,
      range: one ? [Number(one), Number(one)] : range, first: NaN, longName: attr(name, 'long_name') || name, units: attr(name, 'units'),
    }
    if (name === 'time') ax.spacing = spacingDays(sp)
    axes.push(ax)
  }
  // the first value on the depth axis is the surface level the app slices
  const depth = axes.find((a) => a.name === 'depth')
  if (depth) {
    const res = await fetch(`${base}/griddap/${id}.json?depth%5B0:1:0%5D`, { signal: AbortSignal.timeout(60_000) })
    depth.first = res.ok ? Number((await res.json()).table.rows[0][0]) : depth.range[0]
  }
  const vars = rows.filter((r) => r[0] === 'variable').map((r) => ({
    name: r[1], dims: r[4].split(',').map((x) => x.trim()),
    units: attr(r[1], 'units') || null, longName: attr(r[1], 'long_name') || r[1],
  }))
  return { rows, axes, vars }
}
function spacingDays(s: string): number | null {
  const m = s.match(/([\d.]+)\s*days?/i)
  let d = m ? Number(m[1]) : 0
  const h = s.match(/(\d+)h/), mn = s.match(/(\d+)m\b/)
  d += (h ? Number(h[1]) / 24 : 0) + (mn ? Number(mn[1]) / 1440 : 0)
  return d > 0 ? d : null
}
const isoZ = (secs: number) => new Date(secs * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
/** ISO 8601 step for the datacube, or null when the axis is irregular. */
function timeStep(days: number | null): string | null {
  if (!days) return null
  if (days > 0.9 && days < 1.1) return 'P1D'
  if (days > 7.9 && days < 8.1) return 'P8D'
  if (days >= 28 && days <= 31.5) return 'P1M'
  return null
}
const round = (x: number, d = 6) => Number(x.toFixed(d))

// ── one collection ────────────────────────────────────────────────────────────
export function buildCollection(s: Spec, inf: Info, base: string) {
  const ax   = (n: string) => inf.axes.find((a) => a.name === n)
  const time = ax('time')!, lat = ax('latitude')!, lon = ax('longitude')!, depth = ax('depth')
  const latDesc = (lat.spacing ?? 0) < 0
  const t0 = isoZ(time.range[0]), t1 = isoZ(time.range[1])
  const live = s.status !== 'pending'
  const desc = [
    `${s.about} Hosted on the USF IMaRS ERDDAP (${USF}) and re-served with CORS and Parquet by erddap.oceanmetrics.io, referenced in place for computing place statistics in the browser via griddap.parquet.`,
    depth ? `Variables on the ${depth.n}-level depth axis are sliced at the surface level (erddap-places:depth = ${depth.first} m).` : '',
    s.note ?? '',
  ].filter(Boolean).join(' ')
  const dims3 = ['time', ...(depth ? ['depth'] : []), 'latitude', 'longitude']

  const cubeDims: Record<string, any> = {
    time: { type: 'temporal', description: time.longName, extent: [t0, t1], step: timeStep(time.spacing) },
  }
  if (depth) cubeDims.depth = {
    type: 'spatial', axis: 'z', description: `${depth.longName} (positive down; ${depth.n} levels)`,
    extent: [round(depth.range[0]), round(depth.range[1])], unit: depth.units || 'm',
    ...(depth.n === 1 ? { values: [round(depth.first)] } : { step: null }),
  }
  cubeDims.latitude  = { type: 'spatial', axis: 'y', description: 'Latitude',  extent: [lat.range[0], lat.range[1]], step: round(Math.abs(lat.spacing ?? 0)), reference_system: 4326 }
  cubeDims.longitude = { type: 'spatial', axis: 'x', description: 'Longitude', extent: [lon.range[0], lon.range[1]], step: round(Math.abs(lon.spacing ?? 0)), reference_system: 4326 }

  const cubeVars: Record<string, any> = {}
  for (const v of inf.vars) cubeVars[v.name] = {
    dimensions: v.dims, type: 'data', unit: v.units, description: v.longName,
  }

  const latC = latDesc ? '[({lat_max}):1:({lat_min})]' : '[({lat_min}):1:({lat_max})]'
  const depC = depth ? `[(${depth.first}):1:(${depth.first})]` : ''
  const q    = `{variable}[({t0}):1:({t1})]${depC}${latC}[({lon_min}):1:({lon_max})]`
  const columns = [
    { name: 'time', type: 'timestamp', description: time.longName },
    ...(depth ? [{ name: 'depth', type: 'double', description: `Depth, ${depth.units || 'm'} (the one sliced level)` }] : []),
    { name: 'latitude',  type: 'double', description: 'Latitude, degrees_north' },
    { name: 'longitude', type: 'double', description: 'Longitude, degrees_east' },
    ...inf.vars.map((v) => ({ name: v.name, type: 'double', description: `${v.longName}${v.units ? `, ${v.units}` : ''}` })),
  ]

  const c: Record<string, any> = {
    type: 'Collection',
    id  : `erddap/${s.id.toLowerCase()}`,          // lowercase ids (PTL-COL-003); the directory keeps the ERDDAP case
    stac_version: '1.1.0',
    description: desc,
    links: [
      { rel: 'root',   href: '../../catalog.json', type: 'application/json' },
      { rel: 'parent', href: '../../catalog.json', type: 'application/json' },
      { rel: 'agents',      href: './AGENTS.md', type: 'text/markdown', title: 'Agent/LLM usage guide' },
      { rel: 'describedby', href: './README.md', type: 'text/markdown', title: 'Human-readable documentation' },
      { rel: 'via', href: `${USF}/info/${s.id}/index.html`, type: 'text/html', title: `${s.id} (source, USF IMaRS ERDDAP)` },
      ...(s.product ? [{ rel: 'about', href: s.product.href, type: 'text/html', title: s.product.title }] : []),
      ...(s.licenseLink ? [{ rel: 'license', href: s.licenseLink.href, type: 'text/html', title: s.licenseLink.title }] : []),
    ],
    stac_extensions: [
      'https://stac-extensions.github.io/datacube/v2.2.0/schema.json',
      'https://schemas.portolan-sdi.org/portolan/v0.2.0/schema.json',
    ],
    updated: UPDATED,
    title  : s.title,
    extent : {
      spatial : { bbox: [[lon.range[0], lat.range[0], lon.range[1], lat.range[1]]] },
      temporal: { interval: [[t0, t1]] },
    },
    license: s.license,
    providers: [s.producer, USF_HOST, OM],
    'cube:dimensions': cubeDims,
    'cube:variables' : cubeVars,
    'erddap:base_url'      : BASE,
    'erddap:upstream_url'  : USF,
    'erddap:dataset_id'    : s.id,
    'erddap:protocol'      : 'griddap',
    'erddap:version'       : VERSION,
    'erddap:cors'          : true,
    'erddap:formats'       : ['parquet', 'csvp', 'json'],
    'erddap:lon_range'     : [lon.range[0], lon.range[1]],
    'erddap:lat_descending': latDesc,
  }
  if (depth)    c['erddap-places:depth']  = depth.first
  if (!live)    c['erddap-places:status'] = 'pending'
  c.assets = {
    griddap: {
      href : `${BASE}/griddap/${s.id}.parquet?${q}`,
      type : 'application/vnd.apache.parquet',
      title: `griddap query template (percent-encode each constraint separately); latitude ${latDesc ? 'descends' : 'ascends'} on this grid` +
             (depth ? `; the depth constraint is fixed at the surface level, ${depth.first} m` : '') +
             (live ? '' : '; server not yet live'),
      roles: ['data', 'external'],
      'table:columns': columns,
    },
    griddap_upstream: {
      href : `${USF}/griddap/${s.id}.parquet?${q}`,
      type : 'application/vnd.apache.parquet',
      title: 'griddap query template on the source USF IMaRS server',
      roles: ['data', 'external'],
    },
    metadata: {
      href : `${live ? BASE : USF}/info/${s.id}/index.json`,
      type : 'application/json',
      title: `ERDDAP dataset metadata (info endpoint${live ? '' : ', source server'})`,
      roles: ['metadata', 'external'],
    },
  }
  return c
}

// ── docs ──────────────────────────────────────────────────────────────────────
function readme(s: Spec, c: any): string {
  const d = c['cube:dimensions'], depth = d.depth
  const vars = Object.entries(c['cube:variables']).map(([k, v]: [string, any]) => `\`${k}\` (${v.description}${v.unit ? `, ${v.unit}` : ''})`)
  return `# ${s.title}

STAC Collection describing (not mirroring) the \`${s.id}\` ERDDAP griddap dataset. ${s.about}
${s.note ? `\n> **${s.note}**\n` : ''}
- Producer: ${s.producer.name} (${s.producer.url}).
- Source server: \`${USF}\` (USF IMaRS; config [USF-IMARS/erddap-config](https://github.com/USF-IMARS/erddap-config)).
- Server used here: \`${BASE}\` (re-served with CORS + Parquet)${s.status === 'pending' ? ' — **pending, not served yet**' : ''}.
- Coverage: ${d.time.extent[0].slice(0, 10)} to ${d.time.extent[1].slice(0, 10)}${d.time.step ? `, step ${d.time.step}` : ', irregular time steps'}, ${d.latitude.step}° grid, latitude **${c['erddap:lat_descending'] ? 'descending' : 'ascending'}**.
${depth ? `- Depth: ${depth.description}; the app and the precompute slice the surface level, \`erddap-places:depth\` = ${c['erddap-places:depth']} m.\n` : ''}- Variables: ${vars.join('; ')}.
- License/attribution: ${s.license}${s.licenseLink ? ` (${s.licenseLink.href})` : ''}; attribute as "${s.attribution}".

Generated by [\`catalog/build_erddap_collections.ts\`](../../../build_erddap_collections.ts) from the
server's \`info/${s.id}/index.json\`; edit that script, not this file.

## How to read

\`\`\`sql
-- DuckDB: build a griddap parquet URL from the \`griddap\` asset href template in collection.json,
-- percent-encoding each [()...] constraint separately, then:
SELECT * FROM read_parquet('<built griddap.parquet URL>');
\`\`\`

See [\`AGENTS.md\`](AGENTS.md) for the full query-building pattern.
`
}
function agents(s: Spec, c: any): string {
  const d = c['cube:dimensions'], depth = d.depth
  return `# AGENTS.md — ${s.title}

## Overview

${s.about} ${d.time.extent[0].slice(0, 10)} to ${d.time.extent[1].slice(0, 10)}.
${s.status === 'pending' ? 'Status: **pending** (`erddap-places:status: "pending"`): not served by `erddap.oceanmetrics.io` yet; the app lists it greyed out.' : 'Live ERDDAP griddap dataset, referenced in place (not mirrored).'}
${s.note ? `\n${s.note}\n` : ''}
## Accessing the data

Build a griddap URL from the \`griddap\` asset template in \`collection.json\`; see
[\`../AGENTS.md\`](../AGENTS.md) for the full pattern. \`erddap:base_url\` is \`${BASE}\`, which
re-serves the USF IMaRS dataset with CORS and Parquet; \`erddap:upstream_url\` / the
\`griddap_upstream\` asset point at the source, \`${USF}\`.

## Schema & field notes

Grid: ${d.latitude.step}° lat, ${d.longitude.step}° lon, latitude **${c['erddap:lat_descending'] ? 'descending' : 'ascending'}**, longitude ${d.longitude.extent[0]} → ${d.longitude.extent[1]}.
Time: ${d.time.step ? `step ${d.time.step}` : 'irregular steps'}; the live extent is in \`info/${s.id}/index.json\`.
${depth ? `Depth: the variables on the depth axis are 4-D (time, depth, latitude, longitude). Request one level, the
surface, \`[(${c['erddap-places:depth']}):1:(${c['erddap-places:depth']})]\`, between the time and latitude constraints
(\`erddap-places:depth\`; the template already has it). The Parquet then carries a constant \`depth\` column.\n` : ''}
## Related collections

See [\`../../places/\`](../../places/) for place polygons and bboxes to query against.
`
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const only  = process.argv.slice(2)
  const specs = SPECS.filter((s) => !only.length || only.includes(s.id))
  const catPath = join(GAZETTEER, 'catalog.json')
  const cat = JSON.parse(readFileSync(catPath, 'utf8'))
  for (const s of specs) {
    const base = s.status === 'pending' ? USF : BASE
    const inf  = await info(base, s.id)
    const c    = buildCollection(s, inf, base)
    const dir  = join(GAZETTEER, 'erddap', s.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'collection.json'), JSON.stringify(c, null, 2) + '\n')
    writeFileSync(join(dir, 'README.md'), readme(s, c))
    writeFileSync(join(dir, 'AGENTS.md'), agents(s, c))
    const href = `./erddap/${s.id}/collection.json`
    const link = cat.links.find((l: any) => l.rel === 'child' && l.href === href)
    if (link) link.title = s.title
    else {
      // before the stats child, so the erddap collections stay together
      const at = cat.links.findIndex((l: any) => l.rel === 'child' && /stats\//.test(l.href))
      const nl = { rel: 'child', href, type: 'application/json', title: s.title }
      at < 0 ? cat.links.push(nl) : cat.links.splice(at, 0, nl)
    }
    console.log(`${s.id}: ${inf.vars.length} variable(s), ${inf.axes.map((a) => `${a.name}=${a.n}`).join(' ')}` +
                `${c['erddap-places:depth'] != null ? `, depth ${c['erddap-places:depth']}` : ''}${s.status ? ` [${s.status}]` : ''}`)
  }
  writeFileSync(catPath, JSON.stringify(cat, null, 2) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
