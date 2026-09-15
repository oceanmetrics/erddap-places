// the same {{named}}-parameter SQL templates the browser runs, loaded from ../../sql with fs instead
// of Vite's import.meta.glob. the render()/lit() rules are character-for-character the app's
// (app/src/lib/sql.ts): a template change reaches the browser and this script together.
import { readFileSync } from 'node:fs'
import { join }         from 'node:path'
import { REPO }         from './paths'

export type Param  = string | number | boolean | null
export interface Params { [k: string]: Param }

export function template(name: string): string {
  return readFileSync(join(REPO, 'sql', `${name}.sql`), 'utf8')
}

/** params spliced literally (identifiers and expressions: table/column names); everything else quoted. */
const RAW = new Set(['var', 'expr', 'slab', 'mask', 'src'])
export function lit(v: Param): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number')  return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return `'${String(v).replace(/'/g, "''")}'`
}
export function render(name: string, params: Params): string {
  const body = template(name)
  return body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in params)) throw new Error(`template ${name}: missing param ${k}`)
    return RAW.has(k) ? String(params[k]) : lit(params[k])
  }).trim()
}
