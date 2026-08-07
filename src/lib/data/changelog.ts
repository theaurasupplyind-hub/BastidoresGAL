export const CHANGELOG: Record<string, string> = {
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
