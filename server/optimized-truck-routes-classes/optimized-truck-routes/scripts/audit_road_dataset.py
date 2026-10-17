#!/usr/bin/env python3
"""Audit a local road GeoPackage/Shapefile before writing any production rows.

This intentionally does not guess or normalize provider-specific field names.
Run it on a downloaded, licensed source file and use the report to implement an
explicit adapter for that exact release.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from typing import Any

KEYWORDS = (
    "surface", "pavement", "width", "lane", "light", "illumin", "speed",
    "class", "road", "street", "access", "truck", "weight", "height",
    "length", "bridge", "tunnel", "level", "oneway", "direction", "turn",
    "urban", "city", "curve", "restriction", "prohibit", "closed", "valid",
)


def clean(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "item"):
        try:
            value = value.item()
        except (ValueError, TypeError):
            pass
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return value
    if isinstance(value, (str, int, bool)):
        return value
    return str(value)


def audit(path: Path, layer: str | None, max_rows: int | None) -> dict[str, Any]:
    try:
        import geopandas as gpd
    except ImportError as exc:
        raise RuntimeError(
            "Mancano le dipendenze geospaziali. Installa con: "
            "python -m pip install -e '.[geo]' dalla cartella backend."
        ) from exc

    if not path.exists():
        raise FileNotFoundError(f"File non trovato: {path}")

    read_options: dict[str, Any] = {}
    if layer:
        read_options["layer"] = layer
    if max_rows is not None:
        read_options["rows"] = max_rows
    gdf = gpd.read_file(path, **read_options)

    report: dict[str, Any] = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "file_name": path.name,
        "layer_requested": layer,
        "rows_loaded": int(len(gdf)),
        "sample_limit": max_rows,
        "crs": str(gdf.crs) if gdf.crs else None,
        "columns": [],
        "candidate_road_fields": [],
        "geometry": {},
        "extent_wgs84": None,
        "length_m_stats_epsg3067": None,
        "warnings": [],
    }

    geometry_column = gdf.geometry.name if hasattr(gdf, "geometry") else None
    for column in gdf.columns:
        series = gdf[column]
        record = {
            "name": str(column),
            "dtype": str(series.dtype),
            "null_count": int(series.isna().sum()),
            "non_null_pct": round(float(series.notna().mean() * 100), 2) if len(series) else 0.0,
        }
        if column == geometry_column:
            record["geometry_column"] = True
        elif series.dtype == object or str(series.dtype).startswith("category"):
            normalized = series.dropna().astype(str)
            counts = normalized.value_counts().head(20)
            record["top_values"] = [{"value": str(key), "count": int(value)} for key, value in counts.items()]
            record["distinct_count_sample"] = int(normalized.nunique())
        elif str(series.dtype).startswith(("int", "float")):
            numeric = series.dropna()
            if len(numeric):
                record["numeric_min"] = clean(numeric.min())
                record["numeric_max"] = clean(numeric.max())
        report["columns"].append(record)
        if any(token in str(column).lower() for token in KEYWORDS):
            report["candidate_road_fields"].append(str(column))

    geometries = gdf.geometry
    empty = geometries.is_empty
    report["geometry"] = {
        "column": geometry_column,
        "types": {str(k): int(v) for k, v in geometries.geom_type.value_counts(dropna=True).items()},
        "empty_count": int(empty.sum()),
        "missing_count": int(geometries.isna().sum()),
        "invalid_count": int((~geometries.is_valid & ~empty & geometries.notna()).sum()),
    }

    if gdf.crs is None:
        report["warnings"].append("CRS assente: non è possibile trasformare correttamente le geometrie in metri.")
    else:
        try:
            wgs84 = gdf.to_crs(4326)
            bounds = wgs84.total_bounds
            report["extent_wgs84"] = {
                "min_longitude": clean(bounds[0]),
                "min_latitude": clean(bounds[1]),
                "max_longitude": clean(bounds[2]),
                "max_latitude": clean(bounds[3]),
            }
            metric = gdf.to_crs(3067)
            line_mask = metric.geometry.geom_type.isin(["LineString", "MultiLineString"])
            lengths = metric.loc[line_mask, metric.geometry.name].length.dropna()
            if len(lengths):
                report["length_m_stats_epsg3067"] = {
                    "count": int(len(lengths)),
                    "min": round(float(lengths.min()), 2),
                    "median": round(float(lengths.median()), 2),
                    "mean": round(float(lengths.mean()), 2),
                    "max": round(float(lengths.max()), 2),
                }
            else:
                report["warnings"].append("Nessuna geometria lineare caricata; controllare il layer scelto.")
        except Exception as exc:
            report["warnings"].append(f"Errore nel controllo CRS/geometrie: {type(exc).__name__}.")

    report["warnings"].append(
        "Le colonne candidate sono suggerimenti lessicali, non una mappatura semantica verificata. "
        "Controllare documentazione, unità, direzione e codici della release originale."
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path, help="GeoPackage, Shapefile o altro formato supportato da GeoPandas")
    parser.add_argument("--layer", help="Layer da leggere, necessario se il contenitore ne ha più di uno")
    parser.add_argument("--max-rows", type=int, help="Limita l'audit a un campione iniziale")
    parser.add_argument("--output", type=Path, help="Percorso del report JSON; se omesso stampa su stdout")
    args = parser.parse_args()
    if args.max_rows is not None and args.max_rows <= 0:
        parser.error("--max-rows deve essere maggiore di zero")

    try:
        report = audit(args.file, args.layer, args.max_rows)
    except (RuntimeError, FileNotFoundError, ValueError) as exc:
        print(f"Errore: {exc}", file=sys.stderr)
        return 2

    rendered = json.dumps(report, ensure_ascii=False, indent=2, default=str)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
        print(f"Report salvato in {args.output}")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
