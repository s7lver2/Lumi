#!/usr/bin/env python3
"""Benchmark real de Lumi contra su propio servidor `lumid`, por HTTP — no
contra los workers de Python directamente, porque lo que se quiere medir es
la experiencia real de un investigador: subir la foto, esperar, y lo que
tarda y consume la GPU mientras tanto. Solo biblioteca estandar, mismo
criterio que `workers/lumi_bajar.py`: esto es una herramienta de operador,
no una dependencia del producto.

Requisitos que el OPERADOR prepara a mano, no el script:

  1. Un `lumid` corriendo y ONLINE (con al menos un `.lumidx` real instalado
     — decisión tomada explícitamente: medir sobre cobertura real propia, no
     sobre un banco de pruebas genérico como Im2GPS3k, así que la precisión
     que salga de aquí es la de TU corpus, no comparable en crudo con cifras
     de papers publicados).
  2. Una cuenta de administrador y una clave de API emitida para ella
     (pantalla de API Keys, o `POST /v1/api-keys` a mano) — hace falta ser
     admin para saltarse los topes diarios/semanales de análisis normales.
  3. Un caso (`case`) ya creado en algún proyecto, para colgar las imágenes
     de prueba.
  4. Un manifiesto JSONL de consultas: una línea por imagen, con la
     coordenada real donde se tomó. Ejemplo:
       {"archivo": "C:/fotos/plaza.jpg", "lat": 40.4168, "lng": -3.7038}
     Estas fotos NO tienen que estar en el `.lumidx` instalado — de hecho,
     si lo están, se mide memorización, no generalización; el propio
     operador decide qué tan "held-out" quiere que sea su prueba.

Uso:
  python tools/benchmark.py \
    --url https://127.0.0.1:7717 --api-key lumi_ak_... --case 3 \
    --manifiesto banco.jsonl --niveles mini,pro,vision \
    --concurrencia 1,5,10,20 --salida resultados.json

Qué mide, por nivel:
  - Precisión: error de distancia real (Haversine) contra la coordenada del
    manifiesto, clasificado en los mismos umbrales que usan GeoCLIP/PIGEON
    (1/25/200/750/2500 km) para que sea comparable AL MENOS en la forma,
    aunque el corpus no lo sea.
  - Latencia: desde que se crea el análisis hasta que `lumid` lo marca
    'hecho' o 'error', percentiles p50/p95.
  - VRAM: pico observado por `nvidia-smi` mientras el análisis estaba en
    curso. Si `nvidia-smi` no está en PATH (Windows sin CUDA visible, WSL
    mal configurado), esa columna sale `null` en vez de inventar un número.

Y aparte, no por nivel sino una vez:
  - Estrés: dispara N análisis a la vez (mismo nivel, mismas imágenes del
    manifiesto en round-robin) para cada valor de --concurrencia, y mide
    cuánto tarda el LOTE en completarse del todo — es la cifra que
    `web/components/meetmini/BenchmarksMini.tsx` muestra hoy como ejemplo;
    la idea es que este script acabe siendo la fuente real de esos números.
"""
import argparse
import http.client
import json
import math
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from statistics import median

#: Un `lumid` real, local, bajo carga de GPU, corta la conexión de vez en
#: cuando en medio de un sondeo largo -- no es un fallo del análisis en
#: curso (ese sigue corriendo del otro lado), es la conexión HTTP la que se
#: cae. Reintentar el GET/POST unas pocas veces es más honesto que dejar que
#: un corte de red tire 80 análisis ya completados a la basura.
ERRORES_DE_RED = (urllib.error.URLError, http.client.RemoteDisconnected, socket.timeout, ConnectionError, TimeoutError)
REINTENTOS = 4

UMBRALES_KM = [("street", 1), ("city", 25), ("region", 200), ("country", 750), ("continent", 2500)]


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


class Cliente:
    """Un `urllib.request` con la cabecera de autorización ya puesta y un
    contexto TLS sin verificar -- esto es una herramienta de operador contra
    SU PROPIO servidor en `--url`, no un cliente que se conecta a un
    `lumid` ajeno por una clave de emparejamiento; verificar el fingerprint
    aquí sería reimplementar media pila de confianza para un script de un
    solo uso. Si algún día esto habla con un servidor remoto de verdad, ESE
    es el momento de pedirle el fingerprint como a cualquier cliente real."""

    def __init__(self, base_url, api_key):
        self.base = base_url.rstrip("/")
        self.api_key = api_key
        self.ctx = ssl.create_default_context()
        self.ctx.check_hostname = False
        self.ctx.verify_mode = ssl.CERT_NONE

    def _abrir(self, req):
        for intento in range(1, REINTENTOS + 1):
            try:
                return urllib.request.urlopen(req, context=self.ctx, timeout=120)
            except urllib.error.HTTPError:
                raise  # respuesta real del servidor (404, 400...), no un corte de red -- no tiene sentido reintentarla
            except ERRORES_DE_RED as e:
                if intento == REINTENTOS:
                    raise
                espera = 2 * intento
                print(f"    (corte de red, reintento {intento}/{REINTENTOS} en {espera}s: {e})", flush=True)
                time.sleep(espera)

    def get(self, ruta):
        req = urllib.request.Request(
            self.base + ruta, headers={"Authorization": f"Bearer {self.api_key}"})
        with self._abrir(req) as r:
            return json.loads(r.read())

    def post_json(self, ruta, cuerpo):
        data = json.dumps(cuerpo).encode()
        req = urllib.request.Request(
            self.base + ruta, data=data, method="POST",
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"})
        with self._abrir(req) as r:
            return json.loads(r.read())

    def subir_imagen(self, case_id, ruta_archivo):
        limite = uuid.uuid4().hex
        with open(ruta_archivo, "rb") as f:
            contenido = f.read()
        nombre = ruta_archivo.split("/")[-1].split("\\")[-1]
        cuerpo = (
            f"--{limite}\r\n"
            f'Content-Disposition: form-data; name="archivo"; filename="{nombre}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode() + contenido + f"\r\n--{limite}--\r\n".encode()
        req = urllib.request.Request(
            f"{self.base}/v1/cases/{case_id}/images", data=cuerpo, method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": f"multipart/form-data; boundary={limite}",
            },
        )
        with self._abrir(req) as r:
            return json.loads(r.read())[0]["id"]

    def borrar_imagen(self, image_id):
        req = urllib.request.Request(
            f"{self.base}/v1/images/{image_id}", method="DELETE",
            headers={"Authorization": f"Bearer {self.api_key}"})
        try:
            with self._abrir(req):
                pass
        except urllib.error.HTTPError:
            pass  # limpieza best-effort; que falle no debe tumbar el benchmark


class MuestreoVram:
    """Pico de VRAM usada mientras dura un bloque `with`. Un hilo aparte
    pregunta a `nvidia-smi` cada 200ms -- no hay forma de que la propia GPU
    avise sola de "acabo de tocar mi pico", así que hay que sondear. Si
    `nvidia-smi` no existe en PATH, `self.pico_mb` se queda en `None` para
    siempre: mejor un hueco visible en el informe que un cero mentiroso."""

    def __init__(self, intervalo=0.2):
        self.intervalo = intervalo
        self.pico_mb = None
        self._parar = threading.Event()
        self._hilo = None
        self._disponible = self._probar()

    def _probar(self):
        try:
            subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                capture_output=True, timeout=5, check=True)
            return True
        except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            return False

    def _leer_mb(self):
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                capture_output=True, timeout=5, check=True, text=True)
            # Una línea por GPU; con varias GPUs se toma la que más usa, que
            # es la que de verdad importaría si el análisis cae ahí.
            return max(int(x.strip()) for x in out.stdout.splitlines() if x.strip())
        except Exception:
            return None

    def _bucle(self):
        while not self._parar.is_set():
            mb = self._leer_mb()
            if mb is not None:
                self.pico_mb = mb if self.pico_mb is None else max(self.pico_mb, mb)
            self._parar.wait(self.intervalo)

    def __enter__(self):
        if self._disponible:
            self._hilo = threading.Thread(target=self._bucle, daemon=True)
            self._hilo.start()
        return self

    def __exit__(self, *_):
        if self._hilo:
            self._parar.set()
            self._hilo.join(timeout=2)


def esperar_analisis(cliente, analysis_id, timeout=180, paso=0.5):
    inicio = time.monotonic()
    while time.monotonic() - inicio < timeout:
        a = cliente.get(f"/v1/analyses/{analysis_id}")
        if a["state"] in ("hecho", "error"):
            return a
        time.sleep(paso)
    raise TimeoutError(f"análisis {analysis_id} no terminó en {timeout}s")


def clasificar_umbral(error_km):
    for nombre, km in UMBRALES_KM:
        if error_km <= km:
            return nombre
    return "fuera de escala"


def correr_precision(cliente, case_id, manifiesto, niveles, timeout, al_terminar_nivel=None):
    resultados = {}
    for nivel in niveles:
        print(f"\n=== precisión: {nivel} ===", flush=True)
        filas = []
        for item in manifiesto:
            print(f"  {item['archivo']}", flush=True)
            image_id = None
            try:
                image_id = cliente.subir_imagen(case_id, item["archivo"])
                with MuestreoVram() as vram:
                    t0 = time.monotonic()
                    a = cliente.post_json(f"/v1/cases/{case_id}/analyses",
                                           {"image_ids": [image_id], "model": nivel})
                    a = esperar_analisis(cliente, a["id"], timeout=timeout)
                    latencia_s = time.monotonic() - t0

                if a["state"] == "error" or a.get("result_lat") is None:
                    filas.append({
                        "archivo": item["archivo"], "error": a.get("error") or "sin resultado",
                        "latencia_s": latencia_s, "vram_pico_mb": vram.pico_mb,
                    })
                else:
                    error_km = haversine_km(item["lat"], item["lng"], a["result_lat"], a["result_lng"])
                    filas.append({
                        "archivo": item["archivo"], "error_km": round(error_km, 2),
                        "umbral": clasificar_umbral(error_km), "confianza": a.get("result_confidence"),
                        "latencia_s": round(latencia_s, 2), "vram_pico_mb": vram.pico_mb,
                    })
            except Exception as e:
                # Una foto que falla (red agotada tras los reintentos, timeout,
                # lo que sea) no debe tirar las demás decenas de análisis ya
                # medidos -- se anota como fallo y se sigue con la siguiente.
                filas.append({"archivo": item["archivo"], "error": f"{type(e).__name__}: {e}"})
            finally:
                if image_id is not None:
                    cliente.borrar_imagen(image_id)
            print(f"    -> {filas[-1]}", flush=True)

        ok = [f for f in filas if "error_km" in f]
        latencias = [f["latencia_s"] for f in filas if f.get("latencia_s") is not None]
        n = len(filas) or 1
        resultados[nivel] = {
            "filas": filas,
            "n_consultas": len(filas),
            "n_resueltas": len(ok),
            "acierto_por_umbral_pct": {
                nombre: round(100 * sum(1 for f in ok if f["umbral"] in
                                         [u for u, _ in UMBRALES_KM[:i + 1]]) / n, 1)
                for i, (nombre, _) in enumerate(UMBRALES_KM)
            },
            "error_km_mediana": round(median([f["error_km"] for f in ok]), 2) if ok else None,
            "latencia_s_mediana": round(median(latencias), 2) if latencias else None,
            "vram_pico_mb_max": max((f.get("vram_pico_mb") for f in filas if f.get("vram_pico_mb")), default=None),
        }
        if al_terminar_nivel:
            al_terminar_nivel(nivel, resultados[nivel])
    return resultados


def correr_estres(cliente, case_id, manifiesto, nivel, niveles_concurrencia, timeout, al_terminar_lote=None):
    print(f"\n=== estrés: {nivel} ===", flush=True)
    resultados = {}
    for n in niveles_concurrencia:
        print(f"  concurrencia {n}", flush=True)
        # Round-robin sobre el manifiesto: si hay menos fotos que
        # concurrencia pedida, se repiten -- lo que se mide es cómo se
        # comporta la cola con N peticiones a la vez, no N fotos distintas.
        elegidas = [manifiesto[i % len(manifiesto)] for i in range(n)]
        image_ids = [cliente.subir_imagen(case_id, item["archivo"]) for item in elegidas]

        latencias = [None] * n
        errores = [None] * n

        def uno(i, image_id):
            try:
                t0 = time.monotonic()
                a = cliente.post_json(f"/v1/cases/{case_id}/analyses",
                                       {"image_ids": [image_id], "model": nivel})
                esperar_analisis(cliente, a["id"], timeout=timeout)
                latencias[i] = time.monotonic() - t0
            except Exception as e:
                errores[i] = str(e)

        t_lote = time.monotonic()
        hilos = [threading.Thread(target=uno, args=(i, iid)) for i, iid in enumerate(image_ids)]
        for h in hilos:
            h.start()
        for h in hilos:
            h.join()
        duracion_lote_s = time.monotonic() - t_lote

        for image_id in image_ids:
            cliente.borrar_imagen(image_id)

        buenas = [x for x in latencias if x is not None]
        resultados[n] = {
            "duracion_lote_s": round(duracion_lote_s, 2),
            "latencia_s_mediana": round(median(buenas), 2) if buenas else None,
            "fallos": sum(1 for e in errores if e),
        }
        print(f"    -> {resultados[n]}", flush=True)
        if al_terminar_lote:
            al_terminar_lote(n, resultados[n])
    return resultados


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="https://127.0.0.1:7717")
    ap.add_argument("--api-key", required=True)
    ap.add_argument("--case", type=int, required=True)
    ap.add_argument("--manifiesto", required=True, help="JSONL: una línea {archivo, lat, lng} por consulta")
    ap.add_argument("--niveles", default="mini,pro,vision")
    ap.add_argument("--concurrencia", default="1,5,10,20")
    ap.add_argument("--nivel-estres", default="mini", help="qué nivel usar para la prueba de estrés")
    ap.add_argument("--timeout", type=int, default=300, help="segundos a esperar cada análisis (mini solo ya ronda los 150s)")
    ap.add_argument("--sin-estres", action="store_true", help="solo precisión/latencia/VRAM, sin la prueba de concurrencia")
    ap.add_argument("--salida", default="benchmark.json")
    args = ap.parse_args()

    with open(args.manifiesto, encoding="utf-8") as f:
        manifiesto = [json.loads(linea) for linea in f if linea.strip()]
    if not manifiesto:
        sys.exit("el manifiesto está vacío")

    cliente = Cliente(args.url, args.api_key)
    niveles = [n.strip() for n in args.niveles.split(",") if n.strip()]
    concurrencia = [int(n) for n in args.concurrencia.split(",") if n.strip()]

    salida = {
        "generado_en": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "manifiesto": args.manifiesto,
        "n_consultas": len(manifiesto),
        "precision": {},
    }

    def guardar():
        with open(args.salida, "w", encoding="utf-8") as f:
            json.dump(salida, f, ensure_ascii=False, indent=2)

    # Se reescribe el fichero de salida al terminar CADA nivel, no solo al
    # final: con niveles que pueden tardar minutos por foto (pro, vision), un
    # corte a mitad de la última pasada no debe tirar lo que ya se midió de
    # las anteriores.
    def al_terminar_nivel(nivel, resultado):
        salida["precision"][nivel] = resultado
        guardar()
        print(f"  (guardado parcial en {args.salida})", flush=True)

    correr_precision(cliente, args.case, manifiesto, niveles, args.timeout, al_terminar_nivel)
    if not args.sin_estres:
        salida["estres"] = {args.nivel_estres: {}}

        def al_terminar_lote(n, resultado):
            salida["estres"][args.nivel_estres][n] = resultado
            guardar()

        correr_estres(cliente, args.case, manifiesto, args.nivel_estres, concurrencia, args.timeout, al_terminar_lote)
    print(f"\nescrito {args.salida}")


if __name__ == "__main__":
    main()
