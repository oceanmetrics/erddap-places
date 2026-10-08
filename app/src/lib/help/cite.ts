// "Cite this data" (④ Share, and About): one citation per dataset in view, then the gazetteer the
// place came from, then this app with the view's link. Plain text, so it can be copied and tested.
import { citation } from '../sentence'

export const APP_REPO = 'https://github.com/oceanmetrics/erddap-places'
export const APP_URL = 'https://oceanmetrics.io/erddap-places/'
export const GAZETTEER_URL = 'https://storage.oceanmetrics.io/gazetteer/'

/** what a dataset needs to be cited (a catalog Dataset has all of it) */
export interface CiteDataset { collection: any; title: string; baseUrl: string; datasetId: string; protocol?: string }

/** the gazetteer: who drew the boundaries, who assembled them, where they are published */
export function gazetteerCitation(year: string, version?: string | null): string {
  return `Ocean Metrics (${year}). Ocean Metrics gazetteer of marine places${version ? `, places v${version}` : ''}: ` +
    'boundaries from NOAA Office of National Marine Sanctuaries, MarineRegions.org (Flanders Marine Institute) and ' +
    `ProtectedSeas, as GeoParquet and PMTiles with a STAC catalog. Licence: CC-BY-4.0. ${GAZETTEER_URL}`
}

/** this app, its version and the view's link */
export function appCitation(year: string, appVersion: string, url: string): string {
  return `Ocean Metrics for MBON (${year}). erddap-places v${appVersion}: place statistics from ERDDAP, ` +
    `computed in the browser. ${APP_REPO}. View: ${url || APP_URL}`
}

/** the Then vs Now data: CoralTemp rasters and climatologies cut per sanctuary into the gazetteer */
export function thenNowCitation(variable: string, placeName: string, root: string, accessed: string): string {
  return `NOAA Coral Reef Watch. CoralTemp daily global 5 km sea surface temperature (dhw_5km, ${variable}), as daily ` +
    `rasters and day-of-year climatologies for ${placeName}, in the Ocean Metrics gazetteer (${root}), accessed ${accessed}. Licence: CC-BY-4.0.`
}

export interface CiteInput {
  /** the datasets in view (Statistics: the one run; Then vs Now: none from ERDDAP, see `extra`) */
  datasets: CiteDataset[]
  /** citations that are not ERDDAP collections (the Then vs Now rasters) */
  extra?: string[]
  accessed: string
  url: string
  appVersion: string
  gazetteerVersion?: string | null
}

/** the "Cite this data" block: data first (each dataset once), then the places, then the app */
export function citeText(c: CiteInput): string {
  const year = /^\d{4}/.test(c.accessed) ? c.accessed.slice(0, 4) : String(new Date().getUTCFullYear())
  const seen = new Set<string>()
  const data = c.datasets.filter((d) => { const k = `${d.baseUrl}|${d.datasetId}`; if (seen.has(k)) return false; seen.add(k); return true })
    .map((d) => citation(d, c.accessed))
  return [...data, ...(c.extra ?? []), gazetteerCitation(year, c.gazetteerVersion), appCitation(year, c.appVersion, c.url)].join('\n\n')
}
