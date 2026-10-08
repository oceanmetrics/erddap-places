// Help ▾ → Data sources and attribution (also `?modal=sources`): one row per ERDDAP dataset in the
// catalog (provider, licence, DOI where the collection has one, the server it is read from), then
// the places, the Then vs Now rasters, the basemaps and the software. Built from the STAC collections
// the app already loads, so a dataset added to the catalog gets its row without touching this file.
import { citation, datasetDoi, datasetLicence, producer } from '../sentence'
import { gazetteerCitation, placeLayerCitation, type CiteDataset, type PlaceLayer } from './cite'

export interface Source {
  name    : string
  href    : string
  /** what it is for, in a sentence */
  role    : string
  provider?: string
  /** the ERDDAP server (host name and who runs it) */
  server  ?: string
  citation?: string
  licence ?: string
  licenceHref?: string
  doi     ?: string
}

const host = (u: string) => { try { return new URL(u).host } catch { return u } }

/** one row per ERDDAP dataset: producer, licence, DOI, server, the dataset's own citation */
export function datasetSources(datasets: (CiteDataset & { status?: string; collection: any })[], accessed: string): Source[] {
  return datasets.map((d) => {
    const c = d.collection ?? {}
    const hosts = (c.providers ?? []).filter((p: any) => (p?.roles ?? []).includes('host')).map((p: any) => String(p.name))
    const lic = datasetLicence(c)
    const via = (c.links ?? []).find((l: any) => l?.rel === 'via')?.href
    const doi = datasetDoi(c)
    return {
      name    : d.title,
      href    : String(via ?? `${String(d.baseUrl).replace(/\/$/, '')}/info/${d.datasetId}/index.html`),
      role    : `ERDDAP ${d.protocol === 'tabledap' ? 'tabledap table' : 'griddap grid'} ${d.datasetId}${d.status === 'pending' ? ' (listed, not served yet)' : ''}.`,
      provider: producer(c) || undefined,
      server  : `${host(d.baseUrl)}${hosts.length ? ` (${hosts.join(', ')})` : ''}`,
      citation: citation(d, accessed),
      licence : lic.text || undefined,
      licenceHref: lic.href || undefined,
      doi     : doi ? doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '') : undefined,
    }
  })
}

/**
 * the row for the collection the place on screen comes from (a layer of the gazetteer's layers.json): its
 * credit and citation, licence and a link to its STAC collection. None for the `places` collection, which
 * the gazetteer row and the NOAA ONMS / MarineRegions / ProtectedSeas rows already describe.
 */
export function placeLayerSource(l: PlaceLayer | null | undefined): Source[] {
  if (!l || l.slug === 'places') return []
  return [{
    name: l.title, href: `https://storage.oceanmetrics.io/gazetteer/${l.slug}/collection.json`,
    role: `The place on screen is from this gazetteer collection${l.n ? ` (${l.n.toLocaleString('en-US')} places)` : ''}: its boundary is read from the collection's GeoParquet and drawn from its PMTiles.`,
    citation: l.citation ? placeLayerCitation({ ...l, license: null }) : undefined,
    licence: l.license || undefined, licenceHref: l.license_url || undefined,
  }]
}

/** the rows that are not ERDDAP datasets */
export function fixedSources(year: string): Source[] {
  return [
    {
      name: 'Ocean Metrics gazetteer', href: 'https://storage.oceanmetrics.io/gazetteer/catalog.json',
      role: 'The places: 22 collections (NOAA sanctuaries, marine monuments and estuarine reserves, MarineRegions.org and ProtectedSeas areas, the MPA Inventory, BOEM leases and planning areas, and more), as GeoParquet and PMTiles with a STAC catalog, a layers.json manifest and a place index.',
      citation: gazetteerCitation(year), licence: 'CC-BY-4.0', licenceHref: 'https://creativecommons.org/licenses/by/4.0/',
    },
    {
      name: 'NOAA ONMS sanctuary boundaries', href: 'https://sanctuaries.noaa.gov/library/imast_gis.html',
      role: 'The official boundaries of the national marine sanctuaries (the NMS: places).',
      provider: 'NOAA Office of National Marine Sanctuaries', licence: 'US Government work, public domain',
    },
    {
      name: 'MarineRegions.org', href: 'https://www.marineregions.org',
      role: 'Marine regions by MRGID (seas, EEZs, IHO areas).',
      citation: `Flanders Marine Institute (${year}). MarineRegions.org. https://www.marineregions.org`,
      provider: 'Flanders Marine Institute (VLIZ)', licence: 'CC-BY-4.0', licenceHref: 'https://creativecommons.org/licenses/by/4.0/',
    },
    {
      name: 'ProtectedSeas', href: 'https://protectedseas.net',
      role: 'Marine protected and managed areas by PSGID (the Navigator database).',
      provider: 'ProtectedSeas', licence: "ProtectedSeas' terms of use (https://protectedseas.net)",
    },
    {
      name: 'Then vs Now rasters', href: 'https://storage.oceanmetrics.io/gazetteer/rasters/collection.json',
      role: 'NOAA Coral Reef Watch CoralTemp SST (5 km, daily, 1985 onward), cut to each sanctuary as yearly 366-band COGs with day-of-year climatologies (1985–2005, 2003–2012).',
      provider: 'NOAA Coral Reef Watch; processed by Ocean Metrics after the NOAA ONMS climate dashboard', licence: 'CC-BY-4.0',
      licenceHref: 'https://creativecommons.org/licenses/by/4.0/',
    },
    {
      name: 'Basemaps', href: 'https://www.arcgis.com/home/item.html?id=1e126e7520f9466c9ca28b8f28b5e500',
      role: 'Esri World Ocean Base (light theme) and World Dark Gray Base (dark theme), raster tiles.',
      citation: 'Esri, GEBCO, NOAA, National Geographic, Garmin, HERE, Geonames.org, and other contributors',
      licence: "Esri's terms of use",
    },
    {
      name: 'Software', href: 'https://github.com/oceanmetrics/erddap-places',
      role: 'DuckDB-WASM (MIT) computes the statistics in your browser; MapLibre GL JS (BSD-3-Clause) and PMTiles (BSD-3-Clause) draw the map; geotiff.js (MIT) reads the COGs; hyparquet (MIT) reads the gazetteer; Observable Plot (ISC) draws the Time strip; turf (MIT) masks points; html-to-image (MIT) captures the feedback picture; @marinebon/ui the page.',
      licence: 'erddap-places: MIT', licenceHref: 'https://github.com/oceanmetrics/erddap-places/blob/main/LICENSE',
    },
  ]
}
