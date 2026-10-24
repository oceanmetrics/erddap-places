#!/usr/bin/env tsx
// small commands for .github/workflows/stats.yml, kept here so a test covers them.
//   npx tsx src/ci.ts outage-summary [outage.json]   markdown to $GITHUB_STEP_SUMMARY (stdout without it) and
//                                                    one ::warning:: per host; says so when there was no outage
//   npx tsx src/ci.ts prune-unlisted [stats-dir]     delete, from the runner's checkout only, the fetched Items
//                                                    collection.json does not link (they stay on S3)
//   npx tsx src/ci.ts sync-excludes                  the stats sync's --exclude patterns (publish.ts syncExcludes(),
//                                                    every engine series' files and Items), one per line
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { STATS } from './paths'
import { outageMarkdown, type OutageFile } from './outage'
import { unlistedItems } from './stac'
import { syncExcludes } from './publish'

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'outage-summary') {
  const file = arg ?? join(STATS, 'outage.json')
  const out  = (md: string) => process.env.GITHUB_STEP_SUMMARY ? appendFileSync(process.env.GITHUB_STEP_SUMMARY, md) : console.log(md)
  if (!existsSync(file)) out('## Source hosts\n\nEvery source host answered; no unit was skipped.\n')
  else {
    const o: OutageFile = JSON.parse(readFileSync(file, 'utf8'))
    out(outageMarkdown(o))
    for (const h of o.hosts)
      console.log(`::warning title=source host outage::${h.host} did not answer (${h.kinds.join(', ')}); ${h.units_skipped.length} unit(s) skipped, ` +
                  `${h.first_failure} .. ${h.last_failure}. They keep their last published file.`)
  }
} else if (cmd === 'prune-unlisted') {
  const dir = arg ?? STATS
  const gone = unlistedItems(dir)
  for (const f of gone) rmSync(join(dir, 'items', f))
  console.log(`${gone.length} fetched Item(s) not linked by collection.json removed from the checkout (they stay on S3)${gone.length ? ':\n  ' + gone.join('\n  ') : ''}`)
} else if (cmd === 'sync-excludes') {
  for (const p of syncExcludes()) console.log(p)
} else {
  console.error('usage: ci.ts outage-summary [outage.json] | prune-unlisted [stats-dir] | sync-excludes')
  process.exit(2)
}
