export function renderReceiptHtml(params: {
  num: string;
  fecha: string;
  cliente: string;
  contacto: string;
  items: { cantidad: number; descripcion: string; total: number }[];
  total: number;
  envio: number;
  mode?: 'PRESUPUESTO' | 'BORRADOR';
}): string {
  const { num, fecha, cliente, contacto, items, total, envio, mode = 'PRESUPUESTO' } = params;
  const accent = mode === 'BORRADOR' ? '#0d6efd' : '#00C853';
  const envVal = envio || 0;
  const subtotal = total - envVal;
  const envDisplay = envVal === 0 ? "Sin cargo" : `$${envVal.toLocaleString('es-AR')}`;

  let rows = "";
  for (const item of items) {
    if (!item.descripcion.trim()) continue;
    const q = item.cantidad === 0 ? "" : (Number.isInteger(item.cantidad) ? item.cantidad.toString() : item.cantidad.toString());
    const totDisplay = item.cantidad === 0 ? "" : `$${item.total.toFixed(0)}`;
    rows += `<tr><td>${q}</td><td>${escHtml(item.descripcion)}</td><td style="text-align:right">${totDisplay}</td></tr>`;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f5f5;width:400px;padding:16px}
.card{background:#fff;border-radius:16px;padding:24px 20px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.header{text-align:center;margin-bottom:20px}
.header h2{font-size:20px;font-weight:800;letter-spacing:1px;color:#1a1a1a}
.accent-line{width:40px;height:3px;background:${accent};border-radius:2px;margin:8px auto}
.meta{font-size:13px;color:#888}
.client-box{background:#f8faf8;border-radius:12px;padding:12px 14px;margin-bottom:16px;border:1px solid #eef3ee}
.client-name{font-weight:700;font-size:15px;color:#1a1a1a;margin-bottom:2px}
.client-detail{font-size:13px;color:#666}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
th{text-align:left;font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:0.5px;padding:6px 0;border-bottom:1px solid #eee}
td{font-size:13px;padding:6px 0;border-bottom:1px solid #f5f5f5;vertical-align:top}
.divider{border:none;border-top:1px dashed #ddd;margin:8px 0}
.subtotal-line,.shipping-line{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}
.subtotal-line{color:#888}
.shipping-line{color:#555}
.total-box{display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:12px;border-top:2px solid ${accent}}
.total-lbl{font-size:14px;font-weight:600;color:#333}
.total-val{font-size:28px;font-weight:800;color:${accent}}
.footer{text-align:center;margin-top:16px;padding-top:12px;border-top:1px solid #f0f0f0;font-size:11px;color:#bbb}
</style></head>
<body>
<div class="card">
<div class="header">
<h2>BASTIDORES GAL</h2>
<div class="accent-line"></div>
<div class="meta">#${escHtml(num)} | ${escHtml(fecha)}</div>
</div>
<div class="client-box">
<div class="client-name">${escHtml(cliente)}</div>
<div class="client-detail">${escHtml(contacto)}</div>
</div>
<table>
<thead><tr><th width="10%">Cant</th><th>Detalle</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<hr class="divider">
<div class="subtotal-line"><span>Subtotal</span><span>$${subtotal.toLocaleString('es-AR')}</span></div>
<div class="shipping-line"><span class="shipping-label">Envio</span><span>${envDisplay}</span></div>
<div class="total-box"><span class="total-lbl">TOTAL A PAGAR</span><span class="total-val">$${total.toLocaleString('es-AR')}</span></div>
<div class="footer">${mode === 'BORRADOR' ? 'Borrador' : 'Presupuesto'}</div>
</div>
</body>
</html>`;
}

export function renderWspHelperHtml(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box;user-select:none}
body{font-family:"Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif;background:#fff;overflow:hidden}
.win{display:flex;flex-direction:column;height:100vh}
.titlebar{display:flex;align-items:center;gap:6px;background:#128c7e;color:#fff;padding:0 10px;height:34px;flex-shrink:0;-webkit-app-region:drag}
.titlebar svg{-webkit-app-region:no-drag;flex-shrink:0}
.titlebar span{font-size:12.5px;font-weight:600;flex:1}
.close-btn{-webkit-app-region:no-drag;background:none;border:none;color:#fff;cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:4px;transition:background .12s}
.close-btn:hover{background:rgba(255,255,255,0.2)}
.body{flex:1;padding:20px 20px 12px;display:flex;flex-direction:column}
.status{display:flex;align-items:center;gap:8px;color:#16803a;font-weight:700;font-size:13px;margin-bottom:14px}
.instr{color:#555;font-size:12.5px;line-height:1.6;margin:0;flex:1}
.instr strong{color:#333}
.footer{padding:0 20px 16px}
.btn{width:100%;padding:10px;border:none;border-radius:6px;background:#25d366;color:#fff;font-size:13px;font-weight:700;cursor:pointer;transition:background .12s;outline:none}
.btn:hover{background:#1da851}
.btn:active{background:#199a47}
</style></head>
<body>
<div class="win">
<div class="titlebar">
<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
<span>Enviar comprobante</span>
<button class="close-btn" id="close-btn" title="Cerrar">
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
</button>
</div>
<div class="body">
<div class="status">
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16803a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
Imagen copiada al portapapeles
</div>
<p class="instr">1. Abre el chat del contacto en <strong>WhatsApp</strong>.<br>2. Presiona <strong>Ctrl + V</strong> para pegar la imagen.<br>3. Presiona <strong>Enter</strong> para enviar.</p>
</div>
<div class="footer"><button class="btn" id="paste-btn">PEGAR Y ENVIAR</button></div>
</div>
<script>
function closeHelper(){try{window.__TAURI_INTERNALS__.invoke('close_whatsapp_helper')}catch(e){try{window.close()}catch(e2){}}}
document.getElementById('close-btn').addEventListener('click',closeHelper);
document.getElementById('paste-btn').addEventListener('click',closeHelper);
document.addEventListener('paste',closeHelper);
setTimeout(closeHelper,60000);
</script>
</body></html>`;
}

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
