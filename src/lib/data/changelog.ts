export const CHANGELOG: Record<string, string> = {
  '2.3.73': `○ Círculos en molduras: productos con "círculo/circulo/circular" (con/sin tilde, plural) ahora entran a molduras y al PDF como producto a hacer, sin varilla/larguero/travesaño — solo fila resumen Ø30
• Promos en molduras: si la descripción trae "Promo N x M" (ej. 4 x 3, 10 x 8), N se usa como cantidad de bastidores por unidad y se multiplica por cantidad del item (2 promos 4x3 = 8 bastidores) — busca la medida real del bastidor en cualquier token de la descripción
• Fix: promo ya no duplica "PROMO 4X3 · PROMO 4X3 ..." en tarjeta/PDF, ahora "PROMO 4X3 · LIENZO PROFESIONAL"`,
  '2.3.72': `☀️ Modo oscuro ahora en la barra superior, más a mano
🔍 Zoom se puede probar y cancelar sin guardar — al cerrar vuelve como estaba
👥 Buscar cliente ahora encuentra mejor por nombre (prioridad al nombre exacto)
📄 Facturación: arrastrá una fila para duplicarla en varias, con vista previa y desplazamiento automático
➕ Agregá una fila vacía donde quieras con el botón + o Shift+Enter
💰 Costo de envío y totales más confiables
📋 Panel: tocá la flecha de una factura para ver sus productos sin abrir Facturación
✂️ Molduras: detalle "Tajos: N" más claro`,
  '2.3.71': `• Molduras: "Tajos:N" en azul en lugar de flecha/vacío (referencia varilla), quitado Larga/Corta bajo medida — PDF y cards
• PanelControl: lista tareas ordenable recientes arriba/abajo con botón 2 flechas (estética papelera), tachadas siempre al fondo — aplica a papelera, orden backend por antigüedad
• Historial Facturación: filtro "No Confirmadas" ve todas (fetch server ?estado_kanban con with_items:false), chip naranja con contador, combinado con búsqueda
• Backend: GET /invoices filtra por estado_kanban, GET /tasks ordena por done/antigüedad
• Updater: check automático al abrir la app con botón flotante abajo-derecha (versión/notes, "Más tarde" recuerda)
• Fix release: carrera local vs CI corregida (workflow_dispatch), v2.3.7 re-firmado
  `,
  '2.3.7': `• Facturación: botón Buscar en Maps abre Google Maps en ventana hija dockeada a la derecha, vacío abre Maps genérico
  Ventana hija reutilizable (componente BuscarLugar) — precarga la búsqueda del domicilio
  Fix: vacío ya no busca "Buscar en Maps"
  `,
  '2.3.6': `• Molduras: detalle de cortes por varilla (larga/corta) en cards, PDF y modal de detalle
  PDF y cards: varilla larga muestra larguero, varilla corta muestra travesaño con flecha ➡
  Corregida la asociación larguero/travesaño según dónde se incrustan en las varillas
  Kanban: detección de inconsistencias entre estado de entrega y columna kanban con banner de aviso
  Ficha Semanal: sincroniza estado kanban al marcar entrega
`,
  '2.3.5': `• Molduras PDF: layout A4 en 2 columnas con la altura real de cada tarjeta y margenes correctos (sin doble margen)
  Reordenamiento de molduras con previsualizacion por altura medida
  Facturacion: nueva gestion de talleres (guardar/editar/eliminar) y autocompletar taller a direccion
  Items de retirar ya no se muestran como costo en facturas y presupuestos PDF
  Kanban: urgencia y filtros por fecha de entrega final
  Corregido el nombre de la regla en las sugerencias de precio
`,
  '2.3.4': `• PDF de molduras: paginado en 2 columnas por hoja A4 con altura real de cada tarjeta
  - Ya no se cortan tarjetas entre paginas: se acomodan por altura medida
  - Cabeceras alternadas (caja a izquierda/derecha) para marcar las columnas
  Corregido el guardado de items en el Kanban de proceso (recarga la lista)
  Panel de control: aviso de viajes bajo el minimo como icono en la cabecera
  Mas sugerencias de precio al facturar (8) y coincidencias exactas primero
`,
  '2.3.3': `• Modulo de Gastos completo
  - Proveedores: carpetas, timeline con filtros (Todo/Financiero/Stock), movimientos de compra/pago/stock y deuda
  - Gastos con categorias, edicion y pagos divididos (transferencia/efectivo)
  - Sueldos: empleados, pagos y asistencia diaria
  - Gasto Rapido con entrada por texto natural
  - Dashboard de gastos con totales y filtros por fecha
  Corregido el orden del timeline de proveedores y de las listas de gastos por fecha (soporta fechas YYYY-MM-DD y DD/MM/YYYY)
`,
  '2.3.2': `• Panel de control: lee siempre los mismos datos que el mapa
  - Los grupos de viaje son los mismos en mapa y panel
  - Ya no aparecen facturas entregadas en el panel
  - El panel se actualiza solo cada 60 segundos
  - Doble clic sobre un cliente de entregas pendientes abre su factura en Facturación
  Mapas: ya no recalcula el plan al abrir (solo con facturas nuevas) y detecta direcciones nuevas de forma correcta
  Corregido el conteo de entregas pendientes en el panel
`,
  '2.2.14': `• Gastos agregados, nuevo panel de comprobantes y automatizacion por whatsapp
  Desde el Kanban de proceso se puede eliminar items que no deben ir a moldura tachandolos
  Conexion con whatsapp de comprobantes para enviar presupuestos y facturas, de gastos y de asistencia
  revisar el panel de asistencia, Gastos, categorias, etc. para ver las nuevas funcionalidades.
`,
}
