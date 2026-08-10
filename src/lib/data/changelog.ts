export const CHANGELOG: Record<string, string> = {
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
