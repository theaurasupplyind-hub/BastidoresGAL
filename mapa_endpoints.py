# =============================================================
# ENDPOINTS DE MAPA — agregar al final de main.py
# (antes del último comentario #ACTUALIZADO)
# =============================================================

# --- SCHEMA para actualizar coordenadas ---
class CoordsUpdate(BaseModel):
    lat: float
    lng: float

# --- Endpoint 1: todos los clientes con coordenadas ---
@app.get("/mapa/clientes")
def get_clientes_mapa(db: Session = Depends(get_db)):
    """
    Devuelve todos los clientes que tienen lat/lng cargadas.
    Incluye cuántas facturas tienen pendientes (cualquier tipo de entrega).
    """
    clientes = db.query(Client).filter(
        Client.lat != None,
        Client.lng != None
    ).all()

    resultado = []
    for c in clientes:
        pendientes = db.query(Invoice).filter(
            Invoice.cliente_id == c.id,
            Invoice.estado_entrega == "PENDIENTE",
            Invoice.deleted_at == None
        ).count()

        resultado.append({
            "id": c.id,
            "nombre": c.nombre,
            "domicilio": c.domicilio,
            "telefono": c.telefono,
            "lat": c.lat,
            "lng": c.lng,
            "pedidos_pendientes": pendientes,
        })

    return resultado


# --- Endpoint 2: clientes con entrega en una fecha específica ---
@app.get("/mapa/entregas")
def get_entregas_fecha(
    fecha: str = Query(..., description="Fecha en formato YYYY-MM-DD"),
    db: Session = Depends(get_db)
):
    """
    Devuelve los clientes que tienen facturas con entrega programada
    para la fecha indicada (cualquier tipo de entrega).
    """
    facturas = db.query(Invoice).filter(
        Invoice.estado_entrega == "PENDIENTE",
        Invoice.fecha_entrega == fecha,
        Invoice.deleted_at == None
    ).all()

    # Agrupar por cliente
    clientes_map = {}
    for f in facturas:
        if not f.cliente_id:
            continue

        if f.cliente_id not in clientes_map:
            cliente = db.query(Client).filter(Client.id == f.cliente_id).first()
            if not cliente or not cliente.lat:
                continue
            clientes_map[f.cliente_id] = {
                "id": cliente.id,
                "nombre": cliente.nombre,
                "domicilio": cliente.domicilio,
                "telefono": cliente.telefono,
                "lat": cliente.lat,
                "lng": cliente.lng,
                "facturas": [],
            }

        clientes_map[f.cliente_id]["facturas"].append({
            "id": f.id,
            "numero_factura": f.numero_factura,
            "total": f.total,
        })

    return list(clientes_map.values())


# --- Endpoint 3: actualizar coordenadas de un cliente manualmente ---
@app.put("/mapa/clientes/{cliente_id}/coords")
def update_cliente_coords(
    cliente_id: int,
    coords: CoordsUpdate,
    db: Session = Depends(get_db)
):
    """
    Permite corregir manualmente las coordenadas de un cliente
    que no fue geocodificado correctamente.
    """
    cliente = db.query(Client).filter(Client.id == cliente_id).first()
    if not cliente:
        raise HTTPException(404, "Cliente no encontrado")

    cliente.lat = coords.lat
    cliente.lng = coords.lng
    db.commit()
    return {"status": "ok", "lat": coords.lat, "lng": coords.lng}


# --- Endpoint 4: clientes sin geocodificar (para diagnóstico) ---
@app.get("/mapa/sin-geocodificar")
def get_clientes_sin_coords(db: Session = Depends(get_db)):
    """Lista los clientes que todavía no tienen coordenadas."""
    clientes = db.query(Client).filter(
        Client.domicilio != None,
        Client.domicilio != "",
        Client.lat == None
    ).all()
    return [{"id": c.id, "nombre": c.nombre, "domicilio": c.domicilio} for c in clientes]
