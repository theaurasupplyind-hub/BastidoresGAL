"""
Script de geocodificación — Bastidores Gal
Correr UNA SOLA VEZ para agregar lat/lng a los clientes existentes.

Uso:
    pip install requests psycopg2-binary
    DATABASE_URL=postgresql://... python geocodificar_clientes.py
"""

import os
import time
import requests
import psycopg2

DATABASE_URL = os.getenv("DATABASE_URL", "")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# --- Paso 1: agregar columnas si no existen ---
def agregar_columnas(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE clientes
            ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
        """)
        conn.commit()
    print("[OK] Columnas lat/lng listas")

# --- Paso 2: geocodificar con Nominatim (gratis, sin API key) ---
def geocodificar_domicilio(domicilio: str):
    """Convierte un domicilio en (lat, lng) usando Nominatim / OpenStreetMap."""
    direccion = f"{domicilio}, Buenos Aires, Argentina"
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "q": direccion,
        "format": "json",
        "limit": 1,
        "countrycodes": "ar",
    }
    headers = {
        # Nominatim requiere un User-Agent identificable
        "User-Agent": "BastidoresGal/1.0 (app de facturación privada)"
    }
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        data = resp.json()
        if data:
            return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception as e:
        print(f"  Error en request: {e}")
    return None, None

# --- Paso 3: procesar todos los clientes sin coordenadas ---
def geocodificar_todos(conn):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, nombre, domicilio
            FROM clientes
            WHERE domicilio IS NOT NULL
              AND domicilio != ''
              AND lat IS NULL
        """)
        clientes = cur.fetchall()

    print(f"\nClientes a geocodificar: {len(clientes)}")
    ok = 0
    fallidos = []

    for cliente_id, nombre, domicilio in clientes:
        lat, lng = geocodificar_domicilio(domicilio)
        if lat and lng:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE clientes SET lat=%s, lng=%s WHERE id=%s",
                    (lat, lng, cliente_id)
                )
                conn.commit()
            print(f"  [OK] [{cliente_id}] {nombre} -> ({lat:.5f}, {lng:.5f})")
            ok += 1
        else:
            print(f"  [FAIL] [{cliente_id}] {nombre} -- no encontrado: '{domicilio}'")
            fallidos.append((cliente_id, nombre, domicilio))

        # Nominatim pide máximo 1 request por segundo
        time.sleep(1.1)

    print(f"\nResultado: {ok} geocodificados, {len(fallidos)} fallidos")

    if fallidos:
        print("\nClientes sin geocodificar (domicilio ambiguo o incompleto):")
        for cid, nombre, dom in fallidos:
            print(f"  ID {cid} | {nombre} | '{dom}'")
        print("\nTip: corregí el domicilio en la app y volvé a correr el script.")

if __name__ == "__main__":
    if not DATABASE_URL:
        print("ERROR: falta la variable de entorno DATABASE_URL")
        exit(1)

    conn = psycopg2.connect(DATABASE_URL)
    try:
        agregar_columnas(conn)
        geocodificar_todos(conn)
    finally:
        conn.close()
    print("\n[OK] Script terminado.")
