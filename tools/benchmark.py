#!/usr/bin/env python3
"""
benchmark.py — Suite de benchmarks para Astra/Netryx (Lumi).

Este script mide los puntos que más importan para entender cómo escala el
pipeline: throughput de embedding (services/inference), latencia de
verificación geométrica, latencia de búsqueda en pgvector a distintos
tamaños de índice, y un modelo de coste/tiempo puro Python que reproduce las
fórmulas reales de packages/geo-sampling/src/cost.ts y
packages/api-usage/src/budget.ts para proyectar cuánto cuesta y cuánto
tarda indexar áreas de distinto tamaño.

Subcomandos:
    embed         Throughput de POST /embed a distintos tamaños de batch
                  (busca también el punto de fallo por OOM).
    verify        Latencia de POST /verify a distinto nº de candidatos.
    index-scale   Latencia de búsqueda coseno en pgvector a distinto
                  volumen de filas indexadas (usa vectores sintéticos en
                  una tabla de scratch, no toca el esquema real).
    cost-model    Proyección de coste/tiempo de indexado por área, pura
                  aritmética — no necesita ningún servicio corriendo.
    all           Corre todo lo anterior y vuelca un reporte en Markdown
                  listo para pegar en docs/PROOF_OF_CONCEPT.md.

Ejemplos:
    python benchmark.py cost-model --area-km2 0.2 1 5 20
    python benchmark.py embed --url http://localhost:8000 --batch-sizes 1 4 8 16 32 64 128 256 356
    python benchmark.py verify --url http://localhost:8000 --candidates 1 5 10 25 50
    python benchmark.py index-scale --dsn postgresql://netryx:changeme@localhost:5432/netryx_dev
    python benchmark.py all --url http://localhost:8000 --dsn postgresql://... --out results.md

Requisitos: `pip install requests` para embed/verify. `pip install psycopg2-binary`
para index-scale. cost-model no tiene dependencias externas.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import random
import statistics
import sys
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

# ---------------------------------------------------------------------------
# Constantes reales del proyecto (NO inventadas — copiadas de:
#   packages/shared-types/src/settings.ts   (defaults de configuración)
#   apps/worker/src/jobs/index-area.ts      (EMBED_CHUNK_SIZE, headings)
#   packages/geo-sampling/src/cost.ts       (fórmula de coste)
# Si cambian en el repo, actualizar acá también.
# ---------------------------------------------------------------------------
DEFAULT_HEADINGS_PER_POINT = 4          # STREET_VIEW_HEADINGS: 0/90/180/270
DEFAULT_PRICE_PER_IMAGE_USD = 0.007     # STREET_VIEW_PRICE_PER_IMAGE_USD default
DEFAULT_MAX_MONTHLY_BUDGET_USD = 50.0   # MAX_MONTHLY_BUDGET_USD default
DEFAULT_MAX_AREA_KM2 = 5.0              # MAX_AREA_KM2 default (límite duro en la UI)
DEFAULT_MAX_CONCURRENT_REQUESTS = 10    # MAX_CONCURRENT_REQUESTS default (descarga Street View)
EMBED_CHUNK_SIZE = 16                   # apps/worker/src/jobs/index-area.ts — fijo, no configurable
# Punto de referencia real observado en desarrollo (comentario en el propio
# código): un área de 89 puntos × 4 headings = 356 imágenes en un solo batch
# de /embed hizo OOM en el servicio de inferencia corriendo en CPU:
# "not enough memory: you tried to allocate 6375342080 bytes" (~6.375 GB).
OBSERVED_OOM_BATCH_SIZE = 356
OBSERVED_OOM_BYTES = 6_375_342_080

# Densidad observada en la captura de referencia del README: un área de
# 0.2 km² en León produjo 1280 imágenes indexadas (ver docs/screenshots/).
# Esto implica ~6400 imágenes/km² (~1600 puntos/km² a 4 headings), y es la
# base por defecto que usa `cost-model` si no se pasa --images-per-km2.
OBSERVED_IMAGES_PER_KM2 = 1280 / 0.2  # 6400.0


# ---------------------------------------------------------------------------
# Utilidades comunes
# ---------------------------------------------------------------------------

def _percentile(values: list[float], p: float) -> float:
    if not values:
        return float("nan")
    s = sorted(values)
    k = (len(s) - 1) * p
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


def _fmt_table(headers: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for row in rows:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _make_dummy_jpeg_base64(width: int = 640, height: int = 480) -> str:
    """Genera una imagen JPEG mínima válida en memoria (sin depender de
    Pillow/numpy) para no forzar dependencias extra solo por rellenar
    payloads de benchmark. Si Pillow está disponible se usa, si no cae a un
    JPEG de 1x1 replicado a nivel de payload (sirve igual para medir
    latencia/throughput de red + preprocesado, no para validar el
    resultado del embedding en sí)."""
    try:
        from PIL import Image  # type: ignore

        img = Image.new("RGB", (width, height), (random.randint(0, 255),) * 3)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except ImportError:
        # JPEG 1x1 blanco válido, tal cual — suficiente para medir latencia
        # de transporte/decodificación aunque el contenido no varíe.
        tiny_jpeg = bytes.fromhex(
            "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605"
            "080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e27"
            "20222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b0800"
            "01000101011100ffc4001f0000010501010101010100000000000000000102"
            "03040506070809000affc400b5100002010303020403050504040000017d01"
            "02030004110512213141061351617107221451813191a1082342b1c11552d1"
            "f02433627282090a161718191a25262728292a3435363738393a4344454647"
            "48494a53545556575859696a636465666768696a737475767778797a838485"
            "8687888a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac"
            "2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4"
            "f5f6f7f8f9faffda0008010100003f00fbfea28a2800a28a2800a28a2800a2"
            "8a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800"
            "ffd9"
        )
        return base64.b64encode(tiny_jpeg).decode("ascii")


@dataclass
class LatencyStats:
    label: str
    n: int
    ok: int
    failed: int
    latencies_ms: list[float] = field(default_factory=list)
    error: Optional[str] = None

    def summary_row(self) -> list[str]:
        if not self.latencies_ms:
            return [self.label, str(self.n), str(self.ok), str(self.failed), "—", "—", "—", self.error or ""]
        mean = statistics.mean(self.latencies_ms)
        p50 = _percentile(self.latencies_ms, 0.5)
        p95 = _percentile(self.latencies_ms, 0.95)
        return [
            self.label,
            str(self.n),
            str(self.ok),
            str(self.failed),
            f"{mean:.1f}",
            f"{p50:.1f}",
            f"{p95:.1f}",
            self.error or "",
        ]


# ---------------------------------------------------------------------------
# Benchmark: embedding throughput (POST /embed)
# ---------------------------------------------------------------------------

def bench_embed(url: str, batch_sizes: list[int], repeats: int, timeout_s: float) -> list[dict]:
    import requests  # import perezoso: no forzar dependencia si no se usa este subcomando

    results = []
    for batch_size in batch_sizes:
        images = [_make_dummy_jpeg_base64() for _ in range(batch_size)]
        latencies = []
        error = None
        ok_runs = 0
        for _ in range(repeats):
            t0 = time.perf_counter()
            try:
                resp = requests.post(f"{url.rstrip('/')}/embed", json={"images": images}, timeout=timeout_s)
                resp.raise_for_status()
                dt = (time.perf_counter() - t0) * 1000
                latencies.append(dt)
                ok_runs += 1
            except Exception as exc:  # noqa: BLE001 — queremos capturar cualquier fallo (OOM, timeout, 5xx)
                error = f"{type(exc).__name__}: {exc}"
                break  # si un batch falla (ej. OOM), no tiene sentido repetirlo
        throughput = (batch_size / (statistics.mean(latencies) / 1000)) if latencies else 0.0
        results.append({
            "batch_size": batch_size,
            "ok_runs": ok_runs,
            "repeats": repeats,
            "latencies_ms": latencies,
            "mean_ms": statistics.mean(latencies) if latencies else None,
            "p95_ms": _percentile(latencies, 0.95) if latencies else None,
            "images_per_sec": throughput,
            "error": error,
        })
        status = "OK" if not error else f"FALLÓ ({error})"
        print(f"[embed] batch={batch_size:>4}  {status}")
    return results


# ---------------------------------------------------------------------------
# Benchmark: verificación geométrica (POST /verify)
# ---------------------------------------------------------------------------

def bench_verify(url: str, candidate_counts: list[int], repeats: int, timeout_s: float) -> list[dict]:
    import requests

    results = []
    query_image = _make_dummy_jpeg_base64()
    for n_candidates in candidate_counts:
        candidates = [_make_dummy_jpeg_base64() for _ in range(n_candidates)]
        latencies = []
        error = None
        ok_runs = 0
        for _ in range(repeats):
            t0 = time.perf_counter()
            try:
                resp = requests.post(
                    f"{url.rstrip('/')}/verify",
                    json={"query_image": query_image, "candidate_images": candidates},
                    timeout=timeout_s,
                )
                resp.raise_for_status()
                latencies.append((time.perf_counter() - t0) * 1000)
                ok_runs += 1
            except Exception as exc:  # noqa: BLE001
                error = f"{type(exc).__name__}: {exc}"
                break
        results.append({
            "n_candidates": n_candidates,
            "ok_runs": ok_runs,
            "repeats": repeats,
            "mean_ms": statistics.mean(latencies) if latencies else None,
            "p95_ms": _percentile(latencies, 0.95) if latencies else None,
            "ms_per_candidate": (statistics.mean(latencies) / n_candidates) if latencies and n_candidates else None,
            "error": error,
        })
        status = "OK" if not error else f"FALLÓ ({error})"
        print(f"[verify] candidatos={n_candidates:>4}  {status}")
    return results


# ---------------------------------------------------------------------------
# Benchmark: escala del índice en pgvector (búsqueda exacta por coseno)
# ---------------------------------------------------------------------------

def bench_index_scale(
    dsn: str,
    sizes: list[int],
    embedding_dim: int,
    top_k: int,
    queries_per_size: int,
) -> list[dict]:
    import psycopg2  # import perezoso

    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    cur.execute("DROP TABLE IF EXISTS benchmark_vectors_scratch;")
    cur.execute(
        f"CREATE TABLE benchmark_vectors_scratch (id serial PRIMARY KEY, embedding vector({embedding_dim}));"
    )

    results = []
    inserted_so_far = 0
    for target_size in sizes:
        to_insert = target_size - inserted_so_far
        if to_insert > 0:
            batch = 500
            for start in range(0, to_insert, batch):
                n = min(batch, to_insert - start)
                rows = [
                    "(" + "'[" + ",".join(f"{random.uniform(-1, 1):.6f}" for _ in range(embedding_dim)) + "]'" + ")"
                    for _ in range(n)
                ]
                cur.execute(
                    "INSERT INTO benchmark_vectors_scratch (embedding) VALUES " + ",".join(rows)
                )
            inserted_so_far = target_size

        latencies = []
        for _ in range(queries_per_size):
            query_vec = "[" + ",".join(f"{random.uniform(-1, 1):.6f}" for _ in range(embedding_dim)) + "]"
            t0 = time.perf_counter()
            cur.execute(
                "SELECT id FROM benchmark_vectors_scratch ORDER BY embedding <=> %s::vector LIMIT %s;",
                (query_vec, top_k),
            )
            cur.fetchall()
            latencies.append((time.perf_counter() - t0) * 1000)

        results.append({
            "index_size": target_size,
            "mean_ms": statistics.mean(latencies),
            "p95_ms": _percentile(latencies, 0.95),
            "queries": queries_per_size,
        })
        print(f"[index-scale] filas={target_size:>8}  media={statistics.mean(latencies):.2f}ms  p95={_percentile(latencies, 0.95):.2f}ms")

    cur.execute("DROP TABLE IF EXISTS benchmark_vectors_scratch;")
    cur.close()
    conn.close()
    return results


# ---------------------------------------------------------------------------
# Modelo de coste/tiempo — pura aritmética, reproduce cost.ts/budget.ts
# ---------------------------------------------------------------------------

def cost_model(
    area_km2_list: list[float],
    images_per_km2: float,
    price_per_image_usd: float,
    max_monthly_budget_usd: float,
    max_concurrent_requests: int,
    embed_seconds_per_chunk: float,
    seconds_per_street_view_request: float,
) -> list[dict]:
    results = []
    for area_km2 in area_km2_list:
        total_images = area_km2 * images_per_km2
        cost_usd = total_images * price_per_image_usd
        n_chunks = -(-int(total_images) // EMBED_CHUNK_SIZE)  # ceil div

        # Tiempo de descarga: MAX_CONCURRENT_REQUESTS en paralelo, cada
        # request tarda ~seconds_per_street_view_request (valor a medir en
        # tu propia red/API key — ver --sv-request-seconds).
        download_seconds = (total_images / max_concurrent_requests) * seconds_per_street_view_request

        # Tiempo de embedding: chunks de EMBED_CHUNK_SIZE, secuenciales
        # (index-area.ts los procesa uno a la vez, no en paralelo).
        embed_seconds = n_chunks * embed_seconds_per_chunk

        total_minutes = (download_seconds + embed_seconds) / 60
        exceeds_budget = cost_usd > max_monthly_budget_usd
        exceeds_area_limit = area_km2 > DEFAULT_MAX_AREA_KM2

        results.append({
            "area_km2": area_km2,
            "total_images": round(total_images),
            "cost_usd": round(cost_usd, 2),
            "n_embed_chunks": n_chunks,
            "estimated_minutes": round(total_minutes, 1),
            "exceeds_default_monthly_budget": exceeds_budget,
            "exceeds_default_area_limit": exceeds_area_limit,
        })
    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_embed = sub.add_parser("embed", help="Throughput de POST /embed a distintos batch sizes")
    p_embed.add_argument("--url", required=True, help="Base URL del servicio de inferencia, ej. http://localhost:8000")
    p_embed.add_argument("--batch-sizes", type=int, nargs="+", default=[1, 4, 8, 16, 32, 64, 128, 256, OBSERVED_OOM_BATCH_SIZE])
    p_embed.add_argument("--repeats", type=int, default=5)
    p_embed.add_argument("--timeout-s", type=float, default=120.0)

    p_verify = sub.add_parser("verify", help="Latencia de POST /verify a distinto nº de candidatos")
    p_verify.add_argument("--url", required=True)
    p_verify.add_argument("--candidates", type=int, nargs="+", default=[1, 5, 10, 25, 50, 100])
    p_verify.add_argument("--repeats", type=int, default=5)
    p_verify.add_argument("--timeout-s", type=float, default=120.0)

    p_idx = sub.add_parser("index-scale", help="Latencia de búsqueda coseno en pgvector a distinto volumen")
    p_idx.add_argument("--dsn", required=True, help="postgresql://user:pass@host:port/db")
    p_idx.add_argument("--sizes", type=int, nargs="+", default=[1_000, 10_000, 50_000, 100_000, 500_000, 1_000_000])
    p_idx.add_argument("--embedding-dim", type=int, default=8448, help="8448 = dimensión real de Lumi Preview/MegaLoc")
    p_idx.add_argument("--top-k", type=int, default=50)
    p_idx.add_argument("--queries-per-size", type=int, default=20)

    p_cost = sub.add_parser("cost-model", help="Proyección de coste/tiempo por área (sin servicios corriendo)")
    p_cost.add_argument("--area-km2", type=float, nargs="+", default=[0.2, 1, DEFAULT_MAX_AREA_KM2, 20, 100])
    p_cost.add_argument("--images-per-km2", type=float, default=OBSERVED_IMAGES_PER_KM2)
    p_cost.add_argument("--price-per-image-usd", type=float, default=DEFAULT_PRICE_PER_IMAGE_USD)
    p_cost.add_argument("--max-monthly-budget-usd", type=float, default=DEFAULT_MAX_MONTHLY_BUDGET_USD)
    p_cost.add_argument("--max-concurrent-requests", type=int, default=DEFAULT_MAX_CONCURRENT_REQUESTS)
    p_cost.add_argument("--embed-seconds-per-chunk", type=float, default=1.0,
                         help="Segundos por chunk de 16 imágenes — MEDÍ esto con `embed` en tu GPU/CPU real y pasalo acá")
    p_cost.add_argument("--sv-request-seconds", type=float, default=0.3,
                         help="Segundos por imagen de Street View descargada — depende de tu red/cuota real")

    p_all = sub.add_parser("all", help="Corre todos los benchmarks aplicables y genera un reporte Markdown")
    p_all.add_argument("--url", help="Base URL del servicio de inferencia (omitir para saltar embed/verify)")
    p_all.add_argument("--dsn", help="DSN de Postgres (omitir para saltar index-scale)")
    p_all.add_argument("--out", default="benchmark-results.md")

    args = parser.parse_args()

    if args.command == "embed":
        results = bench_embed(args.url, args.batch_sizes, args.repeats, args.timeout_s)
        print(json.dumps(results, indent=2))

    elif args.command == "verify":
        results = bench_verify(args.url, args.candidates, args.repeats, args.timeout_s)
        print(json.dumps(results, indent=2))

    elif args.command == "index-scale":
        results = bench_index_scale(args.dsn, args.sizes, args.embedding_dim, args.top_k, args.queries_per_size)
        print(json.dumps(results, indent=2))

    elif args.command == "cost-model":
        results = cost_model(
            args.area_km2, args.images_per_km2, args.price_per_image_usd,
            args.max_monthly_budget_usd, args.max_concurrent_requests,
            args.embed_seconds_per_chunk, args.sv_request_seconds,
        )
        headers = ["Área (km²)", "Imágenes", "Coste (USD)", "Chunks de embed", "Tiempo est. (min)", "> budget ($50)?", "> límite área (5km²)?"]
        rows = [[
            str(r["area_km2"]), str(r["total_images"]), f"${r['cost_usd']:.2f}", str(r["n_embed_chunks"]),
            str(r["estimated_minutes"]), "Sí" if r["exceeds_default_monthly_budget"] else "No",
            "Sí" if r["exceeds_default_area_limit"] else "No",
        ] for r in results]
        print(_fmt_table(headers, rows))

    elif args.command == "all":
        report_parts = ["# Resultados de benchmark — Astra/Netryx (Lumi)\n"]

        report_parts.append("## Modelo de coste/tiempo (determinista, sin servicios)\n")
        cost_results = cost_model(
            [0.2, 1, DEFAULT_MAX_AREA_KM2, 20, 100], OBSERVED_IMAGES_PER_KM2,
            DEFAULT_PRICE_PER_IMAGE_USD, DEFAULT_MAX_MONTHLY_BUDGET_USD,
            DEFAULT_MAX_CONCURRENT_REQUESTS, 1.0, 0.3,
        )
        headers = ["Área (km²)", "Imágenes", "Coste (USD)", "Chunks de embed", "Tiempo est. (min)", "> budget ($50)?", "> límite área (5km²)?"]
        rows = [[
            str(r["area_km2"]), str(r["total_images"]), f"${r['cost_usd']:.2f}", str(r["n_embed_chunks"]),
            str(r["estimated_minutes"]), "Sí" if r["exceeds_default_monthly_budget"] else "No",
            "Sí" if r["exceeds_default_area_limit"] else "No",
        ] for r in cost_results]
        report_parts.append(_fmt_table(headers, rows) + "\n")

        if args.url:
            report_parts.append("\n## Throughput de embedding (/embed)\n")
            embed_results = bench_embed(args.url, [1, 4, 8, 16, 32, 64, 128, 256, OBSERVED_OOM_BATCH_SIZE], 5, 120.0)
            headers = ["Batch size", "OK/repeats", "Media (ms)", "p95 (ms)", "Imágenes/seg", "Error"]
            rows = [[
                str(r["batch_size"]), f"{r['ok_runs']}/{r['repeats']}",
                f"{r['mean_ms']:.1f}" if r["mean_ms"] else "—",
                f"{r['p95_ms']:.1f}" if r["p95_ms"] else "—",
                f"{r['images_per_sec']:.2f}" if r["mean_ms"] else "—",
                r["error"] or "",
            ] for r in embed_results]
            report_parts.append(_fmt_table(headers, rows) + "\n")

            report_parts.append("\n## Latencia de verificación geométrica (/verify)\n")
            verify_results = bench_verify(args.url, [1, 5, 10, 25, 50, 100], 5, 120.0)
            headers = ["Nº candidatos", "OK/repeats", "Media (ms)", "p95 (ms)", "ms/candidato", "Error"]
            rows = [[
                str(r["n_candidates"]), f"{r['ok_runs']}/{r['repeats']}",
                f"{r['mean_ms']:.1f}" if r["mean_ms"] else "—",
                f"{r['p95_ms']:.1f}" if r["p95_ms"] else "—",
                f"{r['ms_per_candidate']:.2f}" if r["ms_per_candidate"] else "—",
                r["error"] or "",
            ] for r in verify_results]
            report_parts.append(_fmt_table(headers, rows) + "\n")
        else:
            report_parts.append("\n## Throughput de embedding / verificación\n\n_Omitido — no se pasó `--url`._\n")

        if args.dsn:
            report_parts.append("\n## Escala del índice (pgvector, búsqueda exacta por coseno)\n")
            idx_results = bench_index_scale(args.dsn, [1_000, 10_000, 50_000, 100_000, 500_000], 8448, 50, 20)
            headers = ["Filas en el índice", "Media (ms)", "p95 (ms)", "Queries"]
            rows = [[str(r["index_size"]), f"{r['mean_ms']:.2f}", f"{r['p95_ms']:.2f}", str(r["queries"])] for r in idx_results]
            report_parts.append(_fmt_table(headers, rows) + "\n")
        else:
            report_parts.append("\n## Escala del índice (pgvector)\n\n_Omitido — no se pasó `--dsn`._\n")

        report = "\n".join(report_parts)
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(report)
        print(f"\nReporte escrito en {args.out}")
        print(report)


if __name__ == "__main__":
    main()