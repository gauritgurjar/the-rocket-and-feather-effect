# The Rocket and Feather Effect

Public grocery-price explorer for consumers and for the Women in Data Datathon 2026.

Filters: country, food category, and year range. Charts recompute from the paired quarterly panel. The country rank table stays on the full 2016–2026 window.

## Run locally

```bash
python3 scripts/build_web_data.py
cd web
python3 -m http.server 8080
```

Open http://127.0.0.1:8080. Opening `index.html` as a file will not load `data/site.json`.

## Refresh the data

After the pipeline or the 10-year quarterly file changes:

```bash
python3 scripts/build_web_data.py
```

That writes `web/data/site.json` from:

- `output/food_cpi_ppi_quarterly_11country_10y.csv`
- `output/ppi_cpi_asymmetric_passthrough.csv`
- `output/country_ppi_cpi_stickiness_rank.csv`

## Publish

Live: https://gauritgurjar.github.io/the-rocket-and-feather-effect/

The dataset repo is private, so the public site is https://github.com/gauritgurjar/the-rocket-and-feather-effect (the `web/` folder).

Shareable filter URLs look like `?c=CAN&f=Vegetables&from=2021&to=2026`.
