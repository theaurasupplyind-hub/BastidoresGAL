import type { Factura, InvoiceItem } from '$lib/types';

export const PAGE_HEIGHT = 1113;

export interface CardItem {
  cantidad: number;
  medida: string;
  tipo: string;
  varilla?: string;
  larguero?: string;
  travesaño?: string;
  isNonMolding?: boolean;
  isTapacanto?: boolean;
}

export interface CardMaterial {
  type: string;
  qty: number;
  cm: number;
}

export const typeLabel: Record<string, string> = {
  V: 'Varilla',
  L: 'Larguero',
  T: 'Traves.',
};

export function parse2DItem(desc: string): { w: number; h: number; label: string } | null {
  const m = desc.match(/(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const w = parseFloat(m[1].replace(',', '.'));
  const h = parseFloat(m[2].replace(',', '.'));
  const rest = desc.replace(m[0], '').replace(/bastidor|cm|["]/gi, '').trim();
  return { w, h, label: rest || 'Marco' };
}

export function calcMaterials(w: number, h: number, qty: number): CardMaterial[] {
  const result: CardMaterial[] = [];
  const longer = Math.max(w, h);
  const shorter = Math.min(w, h);

  result.push({ type: 'V', qty: 2 * qty, cm: w });
  result.push({ type: 'V', qty: 2 * qty, cm: h });

  let largueros = 0;
  if (longer >= 90 && longer <= 129) largueros = 1;
  else if (longer <= 200) largueros = 2;
  else largueros = 3;

  if (largueros > 0) {
    const larLen = shorter - 5.2;
    result.push({ type: 'L', qty: largueros * qty, cm: Math.round(larLen * 10) / 10 });

    let filas = 0;
    if (shorter >= 90 && shorter <= 129) filas = 1;
    else if (shorter >= 130) filas = 2;

    if (filas > 0) {
      let discount = 9.0;
      if (largueros === 2) discount = 12.8;
      else if (largueros >= 3) discount = 16.5;
      const travLen = (longer - discount) / (largueros + 1);
      const travQty = filas * (largueros + 1) * qty;
      result.push({ type: 'T', qty: travQty, cm: Math.trunc(travLen * 10) / 10 });
    }
  }

  return result;
}

export interface MolduraCorrectionData {
  larguero_qty: number;
  larguero_cm: number;
  travesano_qty: number;
  travesano_cm: number;
}

export function applyCorrection(materials: CardMaterial[], correction: MolduraCorrectionData): CardMaterial[] {
  const filtered = materials.filter(m => m.type === 'V');
  if (correction.larguero_qty > 0) {
    filtered.push({ type: 'L', qty: correction.larguero_qty, cm: correction.larguero_cm });
  }
  if (correction.travesano_qty > 0) {
    filtered.push({ type: 'T', qty: correction.travesano_qty, cm: correction.travesano_cm });
  }
  return filtered;
}

export function consolidateMaterials(items: CardMaterial[]): CardMaterial[] {
  const keyed = new Map<string, CardMaterial>();
  for (const m of items) {
    const key = `${m.type}_${m.cm}`;
    const existing = keyed.get(key);
    if (existing) {
      existing.qty += m.qty;
    } else {
      keyed.set(key, { ...m });
    }
  }
  return Array.from(keyed.values());
}

export function groupMaterials(materials: CardMaterial[]): Array<Record<string, CardMaterial>> {
  const byType: Record<string, CardMaterial[]> = { V: [], L: [], T: [] };
  for (const m of materials) {
    if (byType[m.type]) byType[m.type].push(m);
  }
  const maxRows = Math.max(byType.V.length, byType.L.length, byType.T.length);
  const rows: Array<Record<string, CardMaterial>> = [];
  for (let i = 0; i < maxRows; i++) {
    const row: Record<string, CardMaterial> = {};
    for (const t of ['V', 'L', 'T'] as const) {
      row[t] = byType[t][i];
    }
    rows.push(row);
  }
  return rows;
}

export function colHeight(card: { items: CardItem[]; materials: CardMaterial[] }): number {
  const g = groupMaterials(card.materials).length;
  return 44 * card.items.length + 32 * g + 124;
}

function ffdColumns<T extends { items: CardItem[]; materials: CardMaterial[] }>(
  cards: T[]
): [T[], T[]] {
  const sorted = [...cards].sort((a, b) => colHeight(b) - colHeight(a));
  return splitIntoColumns(sorted, 2);
}

export function splitIntoColumns<T extends { items: CardItem[]; materials: CardMaterial[] }>(
  cards: T[], cols: number
): T[][] {
  const result: T[][] = Array.from({ length: cols }, () => []);
  const heights: number[] = new Array(cols).fill(0);
  for (const card of cards) {
    let minIdx = 0;
    for (let i = 1; i < cols; i++) if (heights[i] < heights[minIdx]) minIdx = i;
    result[minIdx].push(card);
    heights[minIdx] += colHeight(card);
  }
  return result;
}

export function pageAwarePacking<T>(
  items: T[],
  getHeight: (item: T, idx: number) => number
): Array<{ left: T[]; right: T[] }> {
  const sorted = items.map((item, i) => ({ item, idx: i, h: getHeight(item, i) }))
    .sort((a, b) => b.h - a.h);

  const pages: Array<{ left: T[]; right: T[] }> = [];
  let remaining = [...sorted];

  while (remaining.length > 0) {
    const left: T[] = [];
    const right: T[] = [];
    let leftH = 0, rightH = 0;
    const used = new Set<number>();

    for (const s of remaining) {
      if (used.has(s.idx)) continue;
      if (s.h > PAGE_HEIGHT) continue;

      const fitsLeft = leftH + s.h <= PAGE_HEIGHT;
      const fitsRight = rightH + s.h <= PAGE_HEIGHT;

      if (fitsLeft && fitsRight) {
        if (leftH <= rightH) {
          left.push(s.item); leftH += s.h;
        } else {
          right.push(s.item); rightH += s.h;
        }
        used.add(s.idx);
      } else if (fitsLeft) {
        left.push(s.item); leftH += s.h;
        used.add(s.idx);
      } else if (fitsRight) {
        right.push(s.item); rightH += s.h;
        used.add(s.idx);
      }
    }

    if (used.size === 0) break;

    pages.push({ left, right });
    remaining = remaining.filter(s => !used.has(s.idx));
  }

  return pages;
}

export function hasMolduraItems(f: Factura): boolean {
  if (!f.items || f.items.length === 0) return false;
  const doneSet = new Set<number>();
  try {
    const parsed = JSON.parse(f.items_done || '[]');
    if (Array.isArray(parsed)) parsed.forEach((i: number) => doneSet.add(i));
  } catch {}
  for (let i = 0; i < f.items.length; i++) {
    if (doneSet.has(i)) continue;
    const it = f.items[i];
    const desc = it.descripcion || '';
    if (/rollo/i.test(desc)) continue;
    if (/circular/i.test(desc)) return true;
    if (parse2DItem(desc)) return true;
  }
  return false;
}

export function parseCard(f: Factura): {
  id: number;
  num: string;
  cliente: string;
  entrega: string;
  items: CardItem[];
  materials: CardMaterial[];
} {
  const items: CardItem[] = [];
  const allMats: CardMaterial[] = [];
  const doneSet = new Set<number>();
  try {
    const parsed = JSON.parse(f.items_done || '[]');
    if (Array.isArray(parsed)) parsed.forEach((i: number) => doneSet.add(i));
  } catch {}

  for (let i = 0; i < (f.items || []).length; i++) {
    if (doneSet.has(i)) continue;
    const it = f.items[i];
    const desc = it.descripcion || '';
    if (/rollo/i.test(desc)) continue;

    if (/tapacanto/i.test(desc)) {
      items.push({
        cantidad: it.cantidad,
        medida: desc,
        tipo: 'Tapacanto',
        isNonMolding: true,
        isTapacanto: true,
      });
      continue;
    }

    if (/circular/i.test(desc)) {
      const dm = desc.match(/(\d+(?:[.,]\d+)?)/);
      items.push({
        cantidad: it.cantidad,
        medida: dm ? `Ø${dm[1].replace(',', '.')}` : 'Circular',
        tipo: 'Circular',
      });
      continue;
    }

    const parsed = parse2DItem(desc);
    if (parsed) {
      const mats = calcMaterials(parsed.w, parsed.h, it.cantidad);
      items.push({
        cantidad: it.cantidad,
        medida: `${parsed.w}x${parsed.h}`,
        tipo: parsed.label,
          varilla: mats.filter(m => m.type === 'V').map(m => `${m.qty}x${m.cm}`).join(' ') || undefined,
          larguero: mats.filter(m => m.type === 'L').map(m => `${m.qty}x${m.cm}`).join(' ') || undefined,
          travesaño: mats.filter(m => m.type === 'T').map(m => `${m.qty}x${m.cm}`).join(' ') || undefined,
      });
      allMats.push(...mats);
    } else {
      items.push({
        cantidad: it.cantidad,
        medida: desc,
        tipo: 'No moldura',
        isNonMolding: true,
      });
    }
  }

  return {
    id: f.id,
    num: f.numero_factura || `ID:${f.id}`,
    cliente: f.cliente_nombre || '',
    entrega: f.estado_entrega || 'PENDIENTE',
    items,
    materials: consolidateMaterials(allMats).sort((a, b) => {
      const order = { V: 0, L: 1, T: 2 };
      return (order[a.type as keyof typeof order] || 0) - (order[b.type as keyof typeof order] || 0);
    }),
  };
}

export function calcLargueros(longer: number): number {
  if (longer < 90) return 0;
  if (longer >= 90 && longer <= 129) return 1;
  if (longer <= 200) return 2;
  return 3;
}

export function calcFilas(shorter: number): number {
  if (shorter >= 90 && shorter <= 129) return 1;
  if (shorter >= 130) return 2;
  return 0;
}

export function buildFrameSvgForDim(w: number, h: number): string {
  const longer = Math.max(w, h);
  const shorter = Math.min(w, h);
  const largueros = calcLargueros(longer);
  const filas = calcFilas(shorter);
  const sLarge = Math.max(largueros, 1);

  const base = 240;
  const pad = 24, mrg = 10, legH = 24;

  let iw: number, ih: number;
  if (w >= h) {
    iw = base;
    ih = Math.max(Math.round(base * h / w), 70);
  } else {
    iw = Math.max(Math.round(base * w / h), 70);
    ih = base;
  }

  const vbW = iw + pad * 2;
  const vbH = ih + pad * 2 + legH;

  let lines = '';

  lines += `<rect x="${pad}" y="${pad}" width="${iw}" height="${ih}" fill="none" stroke="#2c3e50" stroke-width="3" rx="4"/>`;

  const alongW = w <= h;

  if (alongW) {
    const segH = (ih - 2 * mrg) / sLarge;
    for (let i = 1; i <= largueros; i++) {
      const y = pad + mrg + i * segH;
      lines += `<line x1="${pad + mrg}" y1="${y}" x2="${pad + iw - mrg}" y2="${y}" stroke="#27ae60" stroke-width="2.5"/>`;
    }
    for (let i = 1; i <= filas; i++) {
      const x = pad + mrg + (i * (iw - 2 * mrg)) / (filas + 1);
      lines += `<line x1="${x}" y1="${pad + mrg}" x2="${x}" y2="${pad + ih - mrg}" stroke="#d35400" stroke-width="2" stroke-dasharray="4 3"/>`;
    }
  } else {
    const segW = (iw - 2 * mrg) / sLarge;
    for (let i = 1; i <= largueros; i++) {
      const x = pad + mrg + i * segW;
      lines += `<line x1="${x}" y1="${pad + mrg}" x2="${x}" y2="${pad + ih - mrg}" stroke="#27ae60" stroke-width="2.5"/>`;
    }
    for (let i = 1; i <= filas; i++) {
      const y = pad + mrg + (i * (ih - 2 * mrg)) / (filas + 1);
      lines += `<line x1="${pad + mrg}" y1="${y}" x2="${pad + iw - mrg}" y2="${y}" stroke="#d35400" stroke-width="2" stroke-dasharray="4 3"/>`;
    }
  }

  const dimText = `${w} × ${h} cm`;
  const legendY = vbH - 10;

  return `<svg viewBox="0 0 ${vbW} ${vbH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;max-width:300px;display:block;">
    <rect x="0" y="0" width="${vbW}" height="${vbH}" fill="#fafbfc" rx="6"/>
    ${lines}
    <text x="${pad + iw / 2}" y="${pad - 7}" text-anchor="middle" font-size="10" fill="#888" font-weight="700">${dimText}</text>
    <rect x="${pad}" y="${vbH - 20}" width="72" height="14" rx="4" fill="#eaeaea" opacity="0.95"/>
    <text x="${pad + 6}" y="${legendY}" font-size="9" fill="#2c3e50" font-weight="700">V</text>
    <line x1="${pad + 14}" y1="${legendY - 4}" x2="${pad + 20}" y2="${legendY - 4}" stroke="#2c3e50" stroke-width="2.2"/>
    <text x="${pad + 26}" y="${legendY}" font-size="9" fill="#27ae60" font-weight="700">L</text>
    <line x1="${pad + 34}" y1="${legendY - 4}" x2="${pad + 40}" y2="${legendY - 4}" stroke="#27ae60" stroke-width="2.2"/>
    <text x="${pad + 46}" y="${legendY}" font-size="9" fill="#d35400" font-weight="700">T</text>
    <line x1="${pad + 54}" y1="${legendY - 4}" x2="${pad + 60}" y2="${legendY - 4}" stroke="#d35400" stroke-width="2.2" stroke-dasharray="3 2"/>
  </svg>`;
}

export function buildFrameSvg(items: CardItem[]): string {
  for (const it of items) {
    const m = it.medida.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
    if (m) return buildFrameSvgForDim(parseFloat(m[1]), parseFloat(m[2]));
  }
  return '';
}

export function buildMoldurasHtml(cards: Array<{
  cliente: string;
  num: string;
  items: CardItem[];
  materials: CardMaterial[];
}>): string {
  const [left, right] = splitIntoColumns(cards, 2);

  function renderCard(card: typeof cards[0], side: 'left' | 'right'): string {
    const validItems = card.items.filter(it => !it.isNonMolding || it.isTapacanto);
    const summaryRows = validItems.map(it => {
      return `
        <tr>
          <td width='15%'><span class='sum-qty'>${it.cantidad}</span></td>
          <td width='35%'><span class='sum-dim'>${it.medida}</span></td>
          <td width='50%'><span class='sum-type'>${it.tipo}</span></td>
        </tr>`;
    }).join('');

    const matGroups = groupMaterials(card.materials);
    const matBody = matGroups.map(g => {
      const cells = ['V', 'L', 'T'].map(t => {
        const m = g[t];
        const cls = t === 'V' ? 'td-var' : t === 'L' ? 'td-lar' : 'td-tra';
        if (m) {
          return `<td class='${cls} val-cell'>${m.qty}</td><td class='${cls} val-cell'>${m.cm}</td>`;
        }
        return `<td class='${cls} val-cell'></td><td class='${cls} val-cell'></td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('') || '<tr><td class="td-var val-cell"></td><td class="td-var val-cell"></td><td class="td-lar val-cell"></td><td class="td-lar val-cell"></td><td class="td-tra val-cell"></td><td class="td-tra val-cell"></td></tr>';

    const cliente = card.cliente.length > 25 ? card.cliente.slice(0, 25) : card.cliente;

    const squareLeft = side === 'left'
      ? `<div style='background:#fff;width:54px;height:45px;border-radius:4px;flex-shrink:0;margin-right:10px;'></div><div style='flex:1;'><div class='client-name'>${cliente}</div><div class='order-id'>${card.num}</div></div>`
      : `<div style='flex:1;'><div class='client-name'>${cliente}</div><div class='order-id'>${card.num}</div></div><div style='background:#fff;width:54px;height:45px;border-radius:4px;flex-shrink:0;margin-left:10px;'></div>`;

    return `
<div class='card'>
  <div class='header' style='display:flex;align-items:center;justify-content:space-between;padding:4px 8px;'>
    ${squareLeft}
  </div>
  <table class='summary-table'>
    <tbody>${summaryRows}</tbody>
  </table>
  <table class='mat-table'>
    <thead>
      <tr><th colspan='2' class='th-var'>VARILLA</th><th colspan='2' class='th-lar'>LARGUERO</th><th colspan='2' class='th-tra'>TRAV.</th></tr>
      <tr><th width='12%' class='td-var'>#</th><th width='21%' class='td-var'>CM</th><th width='12%' class='td-lar'>#</th><th width='21%' class='td-lar'>CM</th><th width='12%' class='td-tra'>#</th><th width='21%' class='td-tra'>CM</th></tr>
    </thead>
    <tbody>${matBody}</tbody>
  </table>
</div>`;
  }

  const leftHtml = left.map(c => renderCard(c, 'left')).join('');
  const rightHtml = right.map(c => renderCard(c, 'right')).join('');

  return `<html><head><meta charset='utf-8'>
<style>
    @page { margin: 5px; size: A4; }
    body { font-family: 'Arial', sans-serif; margin: 0; padding: 0; }
    .grid { display: flex; gap: 10px; width: 100%; }
    .col-left, .col-right { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .card { break-inside: avoid; page-break-inside: avoid; border: 4px solid #000; background: #fff; }
    .header { background: #000; color: #fff; text-align: center; }
    .client-name { font-size: 26px; font-weight: 900; line-height: 1; text-transform: uppercase; margin-bottom: 3px; }
    .order-id { font-size: 14px; color: #ddd; }
    .summary-table { width: 100%; border-collapse: collapse; background: #eee; border-bottom: 3px solid #000; }
    .summary-table td { padding: 2px; border: 1px solid #444; vertical-align: middle; }
    .sum-qty { font-size: 32px; font-weight: 900; text-align: center; display: block; }
    .sum-dim { font-size: 24px; font-weight: 900; margin-right: 8px; }
    .sum-type { font-size: 18px; font-weight: bold; text-transform: uppercase; color: #444; }
    .mat-cell { text-align: center; vertical-align: middle; padding: 1px 4px; }
    .mat-detail { font-size: 13px; font-weight: 900; color: #000; white-space: nowrap; }
    .mat-table { width: 100%; border-collapse: collapse; text-align: center; }
    .mat-table th { border: 1px solid #000; padding: 2px; font-size: 18px; font-weight: 900; text-transform: uppercase; }
    .mat-table td { border: 1px solid #000; padding: 0; height: 30px; }
    .th-var { background: #2c3e50; color: #fff; }
    .td-var { background: #ebf5fb; }
    .th-lar { background: #27ae60; color: #fff; }
    .td-lar { background: #e9f7ef; }
    .th-tra { background: #d35400; color: #fff; }
    .td-tra { background: #fdf2e9; }
    .val-cell { font-weight: 900; font-size: 26px; line-height: 1; }
</style>
</head>
<body>
<div class='grid'>
  <div class='col-left'>${leftHtml}</div>
  <div class='col-right'>${rightHtml}</div>
</div></body></html>`;
}

export function buildMoldurasHtmlClasicoModificado(cards: Array<{
  cliente: string;
  num: string;
  items: CardItem[];
  materials: CardMaterial[];
}>): string {
  const [left, right] = splitIntoColumns(cards, 2);

  function renderCard(card: typeof cards[0], side: 'left' | 'right'): string {
    const validItems = card.items.filter(it => !it.isNonMolding || it.isTapacanto);
    const summaryRows = validItems.map(it => {
      return `
        <tr>
          <td width='15%'><span class='sum-qty'>${it.cantidad}</span></td>
          <td width='35%'><span class='sum-dim'>${it.medida}</span></td>
          <td width='50%'><span class='sum-type'>${it.tipo}</span></td>
        </tr>`;
    }).join('');

    const matItems = card.items.filter(it => !it.isNonMolding || it.isTapacanto);
    const larRows: string[] = [];
    const travRows: string[] = [];
    for (const item of matItems) {
      const dims = item.medida.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
      if (!dims) continue;
      const w = parseFloat(dims[1]), h = parseFloat(dims[2]);
      const vs = (item.varilla ?? '').split(' ').filter(Boolean).map(s => {
        const [q, c] = s.split('x'); return { qty: parseInt(q), cm: parseFloat(c) };
      });
      const ls = (item.larguero ?? '').split(' ').filter(Boolean).map(s => {
        const [q, c] = s.split('x'); return { qty: parseInt(q), cm: parseFloat(c) };
      });
      const ts = (item.travesaño ?? '').split(' ').filter(Boolean).map(s => {
        const [q, c] = s.split('x'); return { qty: parseInt(q), cm: parseFloat(c) };
      });
      vs.forEach((v, i) => {
        const withLonger = (w > h && i === 0) || (w < h && i === 1) || (w === h && i === 1);
        if (!withLonger) {
          larRows.push(`<tr>
      <td class='td-var val-cell'>${v.qty}</td><td class='td-var val-cell'>${v.cm}</td>
      <td class='td-lar val-cell'>${ls[0] ? ls[0].qty : ''}</td><td class='td-lar val-cell'>${ls[0] ? ls[0].cm : ''}</td>
      <td class='td-tra val-cell'></td><td class='td-tra val-cell'></td>
    </tr>`);
        } else {
          travRows.push(`<tr>
      <td class='td-var val-cell'>${v.qty}</td><td class='td-var val-cell'>${v.cm}</td>
      ${ts[0] ? `<td class='td-lar val-cell' colspan='2'><span style='font-size:32px;color:#000;font-weight:900;'>➡</span></td>` : `<td class='td-lar val-cell'></td><td class='td-lar val-cell'></td>`}
      <td class='td-tra val-cell'>${ts[0] ? ts[0].qty : ''}</td><td class='td-tra val-cell'>${ts[0] ? ts[0].cm : ''}</td>
    </tr>`);
        }
      });
    }
    const matBody = [...larRows, ...travRows].join('') || '<tr><td class="td-var val-cell"></td><td class="td-var val-cell"></td><td class="td-lar val-cell"></td><td class="td-lar val-cell"></td><td class="td-tra val-cell"></td><td class="td-tra val-cell"></td></tr>';

    const cliente = card.cliente.length > 25 ? card.cliente.slice(0, 25) : card.cliente;

    const squareLeft = side === 'left'
      ? `<div style='background:#fff;width:54px;height:45px;border-radius:4px;flex-shrink:0;margin-right:10px;'></div><div style='flex:1;'><div class='client-name'>${cliente}</div><div class='order-id'>${card.num}</div></div>`
      : `<div style='flex:1;'><div class='client-name'>${cliente}</div><div class='order-id'>${card.num}</div></div><div style='background:#fff;width:54px;height:45px;border-radius:4px;flex-shrink:0;margin-left:10px;'></div>`;

    return `
<div class='card'>
  <div class='header' style='display:flex;align-items:center;justify-content:space-between;padding:4px 8px;'>
    ${squareLeft}
  </div>
  <table class='summary-table'>
    <tbody>${summaryRows}</tbody>
  </table>
  <table class='mat-table'>
    <thead>
      <tr><th colspan='2' class='th-var'>VARILLA</th><th colspan='2' class='th-lar'>LARGUERO</th><th colspan='2' class='th-tra'>TRAV.</th></tr>
      <tr><th width='12%' class='td-var'>#</th><th width='21%' class='td-var'>CM</th><th width='12%' class='td-lar'>#</th><th width='21%' class='td-lar'>CM</th><th width='12%' class='td-tra'>#</th><th width='21%' class='td-tra'>CM</th></tr>
    </thead>
    <tbody>${matBody}</tbody>
  </table>
</div>`;
  }

  const leftHtml = left.map(c => renderCard(c, 'left')).join('');
  const rightHtml = right.map(c => renderCard(c, 'right')).join('');

  return `<html><head><meta charset='utf-8'>
<style>
    @page { margin: 5px; size: A4; }
    body { font-family: 'Arial', sans-serif; margin: 0; padding: 0; }
    .grid { display: flex; gap: 10px; width: 100%; }
    .col-left, .col-right { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .card { break-inside: avoid; page-break-inside: avoid; border: 4px solid #000; background: #fff; }
    .header { background: #000; color: #fff; text-align: center; }
    .client-name { font-size: 26px; font-weight: 900; line-height: 1; text-transform: uppercase; margin-bottom: 3px; }
    .order-id { font-size: 14px; color: #ddd; }
    .summary-table { width: 100%; border-collapse: collapse; background: #eee; border-bottom: 3px solid #000; }
    .summary-table td { padding: 2px; border: 1px solid #444; vertical-align: middle; }
    .sum-qty { font-size: 32px; font-weight: 900; text-align: center; display: block; }
    .sum-dim { font-size: 24px; font-weight: 900; margin-right: 8px; }
    .sum-type { font-size: 18px; font-weight: bold; text-transform: uppercase; color: #444; }
    .mat-cell { text-align: center; vertical-align: middle; padding: 1px 4px; }
    .mat-detail { font-size: 13px; font-weight: 900; color: #000; white-space: nowrap; }
    .mat-table { width: 100%; border-collapse: collapse; text-align: center; }
    .mat-table th { border: 1px solid #000; padding: 2px; font-size: 18px; font-weight: 900; text-transform: uppercase; }
    .mat-table td { border: 1px solid #000; padding: 0; height: 30px; }
    .th-var { background: #2c3e50; color: #fff; }
    .td-var { background: #ebf5fb; }
    .th-lar { background: #27ae60; color: #fff; }
    .td-lar { background: #e9f7ef; }
    .th-tra { background: #d35400; color: #fff; }
    .td-tra { background: #fdf2e9; }
    .val-cell { font-weight: 900; font-size: 26px; line-height: 1; }
</style>
</head>
<body>
<div class='grid'>
  <div class='col-left'>${leftHtml}</div>
  <div class='col-right'>${rightHtml}</div>
</div></body></html>`;
}

export function buildMoldurasHtmlJuli(cards: Array<{
  cliente: string;
  num: string;
  items: CardItem[];
  materials: CardMaterial[];
}>): string {
  const [left, right] = splitIntoColumns(cards, 2);

  function renderCard(card: typeof cards[0], side: 'left' | 'right'): string {
    const validItems = card.items.filter(it => !it.isNonMolding || it.isTapacanto);
    const summaryRows = validItems.map(it => {
      const lHtml = it.larguero ? `<span class='mat-detail lar'>${it.larguero}</span>` : '<span class="mat-detail lar">—</span>';
      const tHtml = it.travesaño ? `<span class='mat-detail tra'>${it.travesaño}</span>` : '<span class="mat-detail tra">—</span>';
      return `
        <tr>
          <td width='15%' rowspan='2'><span class='sum-qty'>${it.cantidad}</span></td>
          <td width='30%' rowspan='2'><span class='sum-dim'>${it.medida}</span></td>
          <td width='30%' rowspan='2'><span class='sum-type'>${it.tipo}</span></td>
          <td width='25%' class='mat-cell'>${lHtml}</td>
        </tr>
        <tr><td class='mat-cell'>${tHtml}</td></tr>`;
    }).join('');

    const cliente = card.cliente.length > 30 ? card.cliente.slice(0, 30) : card.cliente;

    const square = side === 'left'
      ? `<div style='background:#fff;width:54px;height:45px;border-radius:4px;flex-shrink:0;margin-right:10px;'></div><div style='flex:1;'><div class='client-name'>${cliente}</div><div class='order-id'>${card.num}</div></div>`
      : `<div style='flex:1;'><div class='client-name'>${cliente}</div><div class='order-id'>${card.num}</div></div><div style='background:#fff;width:54px;height:45px;border-radius:4px;flex-shrink:0;margin-left:10px;'></div>`;

    return `
<div class='card'>
  <div class='header' style='display:flex;align-items:center;justify-content:space-between;padding:4px 8px;'>
    ${square}
  </div>
  <table class='summary-table'>
    <tbody>${summaryRows}</tbody>
  </table>
</div>`;
  }

  const leftHtml = left.map(c => renderCard(c, 'left')).join('');
  const rightHtml = right.map(c => renderCard(c, 'right')).join('');

  return `<html><head><meta charset='utf-8'>
<style>
    @page { margin: 5px; size: A4; }
    body { font-family: 'Arial', sans-serif; margin: 0; padding: 0; }
    .grid { display: flex; gap: 10px; width: 100%; }
    .col-left, .col-right { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .card { break-inside: avoid; page-break-inside: avoid; border: 4px solid #000; background: #fff; }
    .header { background: #000; color: #fff; text-align: center; }
    .client-name { font-size: 26px; font-weight: 900; line-height: 1; text-transform: uppercase; margin-bottom: 3px; }
    .order-id { font-size: 14px; color: #ddd; }
    .summary-table { width: 100%; border-collapse: collapse; background: #eee; border-bottom: 3px solid #000; }
    .summary-table td { padding: 8px 4px; border: 1px solid #444; vertical-align: middle; }
    .sum-qty { font-size: 32px; font-weight: 900; text-align: center; display: block; }
    .sum-dim { font-size: 24px; font-weight: 900; margin-right: 8px; }
    .sum-type { font-size: 18px; font-weight: bold; text-transform: uppercase; color: #444; }
    .mat-cell { text-align: center; vertical-align: middle; padding: 6px 8px; }
    .mat-detail { font-size: 14px; font-weight: 700; color: #fff; padding: 3px 10px; border-radius: 4px; display: inline-block; white-space: nowrap; }
    .mat-detail.lar { background: #27ae60; }
    .mat-detail.tra { background: #d35400; }
</style>
</head>
<body>
<div class='grid'>
  <div class='col-left'>${leftHtml}</div>
  <div class='col-right'>${rightHtml}</div>
</div></body></html>`;
}

export function getTemplateCss(template: string): string {
  if (template === 'juli') {
    return `
.card { break-inside: avoid; page-break-inside: avoid; border: 4px solid #000; background: #fff; }
.header { background: #000; color: #fff; text-align: center; }
.client-name { font-size: 26px; font-weight: 900; line-height: 1; text-transform: uppercase; margin-bottom: 3px; }
.order-id { font-size: 14px; color: #ddd; }
.summary-table { width: 100%; border-collapse: collapse; background: #eee; border-bottom: 3px solid #000; }
.summary-table td { padding: 8px 4px; border: 1px solid #444; vertical-align: middle; }
.sum-qty { font-size: 32px; font-weight: 900; text-align: center; display: block; }
.sum-dim { font-size: 24px; font-weight: 900; margin-right: 8px; }
.sum-type { font-size: 18px; font-weight: bold; text-transform: uppercase; color: #444; }
.mat-cell { text-align: center; vertical-align: middle; padding: 6px 8px; }
.mat-detail { font-size: 14px; font-weight: 700; color: #fff; padding: 3px 10px; border-radius: 4px; display: inline-block; white-space: nowrap; }
.mat-detail.lar { background: #27ae60; }
.mat-detail.tra { background: #d35400; }`;
  }
  return `
.card { break-inside: avoid; page-break-inside: avoid; border: 4px solid #000; background: #fff; }
.header { background: #000; color: #fff; text-align: center; }
.client-name { font-size: 26px; font-weight: 900; line-height: 1; text-transform: uppercase; margin-bottom: 3px; }
.order-id { font-size: 14px; color: #ddd; }
.summary-table { width: 100%; border-collapse: collapse; background: #eee; border-bottom: 3px solid #000; }
.summary-table td { padding: 2px; border: 1px solid #444; vertical-align: middle; }
.sum-qty { font-size: 32px; font-weight: 900; text-align: center; display: block; }
.sum-dim { font-size: 24px; font-weight: 900; margin-right: 8px; }
.sum-type { font-size: 18px; font-weight: bold; text-transform: uppercase; color: #444; }
.mat-cell { text-align: center; vertical-align: middle; padding: 1px 4px; }
.mat-detail { font-size: 13px; font-weight: 900; color: #000; white-space: nowrap; }
.mat-table { width: 100%; border-collapse: collapse; text-align: center; }
.mat-table th { border: 1px solid #000; padding: 2px; font-size: 18px; font-weight: 900; text-transform: uppercase; }
.mat-table td { border: 1px solid #000; padding: 0; height: 30px; }
.th-var { background: #2c3e50; color: #fff; }
.td-var { background: #ebf5fb; }
.th-lar { background: #27ae60; color: #fff; }
.td-lar { background: #e9f7ef; }
.th-tra { background: #d35400; color: #fff; }
.td-tra { background: #fdf2e9; }
.val-cell { font-weight: 900; font-size: 26px; line-height: 1; }`;
}

export function renderSingleCardHtml(card: {
  cliente: string;
  num: string;
  items: CardItem[];
  materials: CardMaterial[];
}, template: string, idx: number): string {
  const cliente = card.cliente.length > (template === 'juli' ? 30 : 25) ? card.cliente.slice(0, template === 'juli' ? 30 : 25) : card.cliente;
  const validItems = card.items.filter(it => !it.isNonMolding || it.isTapacanto);

  const square = `<div style='background:#fff;width:54px;height:45px;border-radius:4px;flex-shrink:0;margin-right:10px;'></div><div style='flex:1;'><div class='client-name'>${cliente}</div><div class='order-id'>${card.num}</div></div>`;

  if (template === 'juli') {
    const summaryRows = validItems.map(it => {
      const lHtml = it.larguero ? `<span class='mat-detail lar'>${it.larguero}</span>` : '<span class="mat-detail lar">—</span>';
      const tHtml = it.travesaño ? `<span class='mat-detail tra'>${it.travesaño}</span>` : '<span class="mat-detail tra">—</span>';
      return `
        <tr>
          <td width='15%' rowspan='2'><span class='sum-qty'>${it.cantidad}</span></td>
          <td width='30%' rowspan='2'><span class='sum-dim'>${it.medida}</span></td>
          <td width='30%' rowspan='2'><span class='sum-type'>${it.tipo}</span></td>
          <td width='25%' class='mat-cell'>${lHtml}</td>
        </tr>
        <tr><td class='mat-cell'>${tHtml}</td></tr>`;
    }).join('');
    return `
<div class='card' data-card-idx='${idx}'>
  <div class='header' style='display:flex;align-items:center;justify-content:space-between;padding:4px 8px;'>
    ${square}
  </div>
  <table class='summary-table'>
    <tbody>${summaryRows}</tbody>
  </table>
</div>`;
  }

  const summaryRows = validItems.map(it => {
    return `
      <tr>
        <td width='15%'><span class='sum-qty'>${it.cantidad}</span></td>
        <td width='35%'><span class='sum-dim'>${it.medida}</span></td>
        <td width='50%'><span class='sum-type'>${it.tipo}</span></td>
      </tr>`;
  }).join('');

  let matBody: string;
  if (template === 'clasico-modificado') {
    const matItems = card.items.filter(it => !it.isNonMolding || it.isTapacanto);
    const larRows: string[] = [];
    const travRows: string[] = [];
    for (const item of matItems) {
      const dims = item.medida.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
      if (!dims) continue;
      const w = parseFloat(dims[1]), h = parseFloat(dims[2]);
      const vs = (item.varilla ?? '').split(' ').filter(Boolean).map(s => {
        const [q, c] = s.split('x'); return { qty: parseInt(q), cm: parseFloat(c) };
      });
      const ls = (item.larguero ?? '').split(' ').filter(Boolean).map(s => {
        const [q, c] = s.split('x'); return { qty: parseInt(q), cm: parseFloat(c) };
      });
      const ts = (item.travesaño ?? '').split(' ').filter(Boolean).map(s => {
        const [q, c] = s.split('x'); return { qty: parseInt(q), cm: parseFloat(c) };
      });
      vs.forEach((v, i) => {
        const withLonger = (w > h && i === 0) || (w < h && i === 1) || (w === h && i === 1);
        if (!withLonger) {
          larRows.push(`<tr>
      <td class='td-var val-cell'>${v.qty}</td><td class='td-var val-cell'>${v.cm}</td>
      <td class='td-lar val-cell'>${ls[0] ? ls[0].qty : ''}</td><td class='td-lar val-cell'>${ls[0] ? ls[0].cm : ''}</td>
      <td class='td-tra val-cell'></td><td class='td-tra val-cell'></td>
    </tr>`);
        } else {
          travRows.push(`<tr>
      <td class='td-var val-cell'>${v.qty}</td><td class='td-var val-cell'>${v.cm}</td>
      ${ts[0] ? `<td class='td-lar val-cell' colspan='2'><span style='font-size:32px;color:#000;font-weight:900;'>➡</span></td>` : `<td class='td-lar val-cell'></td><td class='td-lar val-cell'></td>`}
      <td class='td-tra val-cell'>${ts[0] ? ts[0].qty : ''}</td><td class='td-tra val-cell'>${ts[0] ? ts[0].cm : ''}</td>
    </tr>`);
        }
      });
    }
    matBody = [...larRows, ...travRows].join('') || '<tr><td class="td-var val-cell"></td><td class="td-var val-cell"></td><td class="td-lar val-cell"></td><td class="td-lar val-cell"></td><td class="td-tra val-cell"></td><td class="td-tra val-cell"></td></tr>';
  } else {
    const matGroups = groupMaterials(card.materials);
    matBody = matGroups.map(g => {
      const cells = ['V', 'L', 'T'].map(t => {
        const m = g[t];
        const cls = t === 'V' ? 'td-var' : t === 'L' ? 'td-lar' : 'td-tra';
        if (m) {
          return `<td class='${cls} val-cell'>${m.qty}</td><td class='${cls} val-cell'>${m.cm}</td>`;
        }
        return `<td class='${cls} val-cell'></td><td class='${cls} val-cell'></td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('') || '<tr><td class="td-var val-cell"></td><td class="td-var val-cell"></td><td class="td-lar val-cell"></td><td class="td-lar val-cell"></td><td class="td-tra val-cell"></td><td class="td-tra val-cell"></td></tr>';
  }

  return `
<div class='card' data-card-idx='${idx}'>
  <div class='header' style='display:flex;align-items:center;justify-content:space-between;padding:4px 8px;'>
    ${square}
  </div>
  <table class='summary-table'>
    <tbody>${summaryRows}</tbody>
  </table>
  <table class='mat-table'>
    <thead>
      <tr><th colspan='2' class='th-var'>VARILLA</th><th colspan='2' class='th-lar'>LARGUERO</th><th colspan='2' class='th-tra'>TRAV.</th></tr>
      <tr><th width='12%' class='td-var'>#</th><th width='21%' class='td-var'>CM</th><th width='12%' class='td-lar'>#</th><th width='21%' class='td-lar'>CM</th><th width='12%' class='td-tra'>#</th><th width='21%' class='td-tra'>CM</th></tr>
    </thead>
    <tbody>${matBody}</tbody>
  </table>
</div>`;
}

export function buildMoldurasHtmlByTemplate(cards: Array<{
  cliente: string;
  num: string;
  items: CardItem[];
  materials: CardMaterial[];
}>, template: string): string {
  if (template === 'juli') return buildMoldurasHtmlJuli(cards);
  if (template === 'clasico-modificado') return buildMoldurasHtmlClasicoModificado(cards);
  return buildMoldurasHtml(cards);
}
