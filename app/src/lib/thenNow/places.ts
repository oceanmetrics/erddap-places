// the sanctuary picker's list: only the place_id, name, gazetteer and bbox columns of places.parquet,
// read with hyparquet over range requests (a few hundred kB instead of the 4 MB of geometry the
// statistics mode loads), and only the NMS gazetteer.
import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

export interface LitePlace { place_id: string; name: string; bbox: [number, number, number, number] }

export async function loadSanctuaries(root: string, gazetteer = 'NMS'): Promise<LitePlace[]> {
  const file = await asyncBufferFromUrl({ url: `${root}places/places.parquet` })
  const rows = await parquetReadObjects({ file, compressors, columns: ['place_id', 'gazetteer', 'name', 'bbox'] })
  return rows
    .filter((r: any) => String(r.gazetteer) === gazetteer)
    .map((r: any) => ({
      place_id: String(r.place_id), name: String(r.name),
      bbox: [Number(r.bbox.xmin), Number(r.bbox.ymin), Number(r.bbox.xmax), Number(r.bbox.ymax)] as LitePlace['bbox'],
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
