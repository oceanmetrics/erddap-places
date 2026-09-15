// the {{named}}-parameter SQL templates in ../../sql, loaded and rendered without pulling in
// DuckDB-WASM: that keeps them testable in plain Node (see sql.test.ts, which runs the rendered SQL
// through the native `duckdb` CLI) and keeps the browser and the CLI on the same text.
const templates = import.meta.glob('../../../sql/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export function template(name: string): string {
  const k = Object.keys(templates).find((p) => p.endsWith(`/${name}.sql`))
  if (!k) throw new Error(`no SQL template ${name} (have: ${Object.keys(templates).join(', ')})`)
  return templates[k]
}
export function templateNames(): string[] {
  return Object.keys(templates).map((p) => p.split('/').pop()!.replace(/\.sql$/, '')).sort()
}

export type Param = string | number | boolean | null
export interface Params { [k: string]: Param }

/** params spliced literally (identifiers and expressions: table/column names); everything else quoted. */
const RAW = new Set(['var', 'expr', 'slab', 'mask', 'src'])
export function lit(v: Param): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
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
