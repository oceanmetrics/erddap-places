# catalog/

- `build_places.R` — builds `places/places.parquet` and `places/places.pmtiles` (20 marine place
  polygons: NOAA sanctuaries, MarineRegions MRGID, ProtectedSeas PSGID). Run with
  `Rscript catalog/build_places.R`.
- `places/` — build output directory. `gazetteer/places/` is the published copy tracked by
  Portolan (currently synced by hand after each rebuild; not auto-linked).
- `gazetteer/` — the published Portolan/STAC catalog (`places` + `erddap/*` collections). Validate
  with `rashid check catalog/gazetteer` / `portolan check catalog/gazetteer`.

## Publish

```bash
portolan push catalog/gazetteer s3://oceanmetrics.io-public/gazetteer --collection places
portolan push catalog/gazetteer s3://oceanmetrics.io-public/gazetteer --collection erddap/dhw_5km
portolan push catalog/gazetteer s3://oceanmetrics.io-public/gazetteer --collection erddap/jplMURSST41
# or push everything, and push the catalog root files (catalog.json/README.md/AGENTS.md):
portolan push catalog/gazetteer s3://oceanmetrics.io-public/gazetteer
```

Public base URL: `https://storage.oceanmetrics.io/gazetteer/`.
