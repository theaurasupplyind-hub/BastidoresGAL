import type { Factura, InvoiceItem } from '$lib/types';

const A4_W_PX = (210 / 25.4) * 96;
const A4_H_PX = (297 / 25.4) * 96;
const PAGE_MARGIN_PX = 5;
const CARD_GAP = 8;

export const PAGE_HEIGHT = Math.floor(A4_H_PX - 2 * PAGE_MARGIN_PX) - 1;
export const PDF_COLUMN_WIDTH_PX = Math.round((A4_W_PX - 2 * PAGE_MARGIN_PX - 10) / 2);

export interface CardItem {
  cantidad: number;
  medida: string;
  tipo: string;
  varilla?: string;
  larguero?: string;
  travesaño?: string;
  isNonMolding?: boolean;
  isTapacanto?: boolean;
  isCirculo?: boolean;
  hasCorrection?: boolean;
  correctionInherited?: boolean;
}

// ── Círculos ──
export function isCirculoDesc(desc: string): boolean {
  return /c[ií]rcul[oa]s?\b/i.test(desc) || /circular/i.test(desc);
}

export function parseCirculoMedida(desc: string): string {
  const m = desc.match(/(\d+(?:[.,]\d+)?)/);
  return m ? `Ø${m[1].replace(',', '.')}` : 'Círculo';
}

// ── Promo ──
export function parsePromoBastidores(desc: string, itemCantidad: number): number | null {
  const m = desc.match(/promo[^0-9]*(\d+)\s*[xX×]\s*(\d+)/i);
  if (!m) return null;
  const perUnit = parseInt(m[1], 10);
  if (isNaN(perUnit) || perUnit <= 0) return null;
  return perUnit * (itemCantidad || 1);
}

export function extractBastidorDimsFromDesc(desc: string): { w: number; h: number } | null {
  const all = [...desc.matchAll(/(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)/g)];
  const real = all
    .map(c => ({ w: parseFloat(c[1].replace(',', '.')), h: parseFloat(c[2].replace(',', '.')) }))
    .filter(d => Math.max(d.w, d.h) >= 15);
  if (real.length > 0) return real[real.length - 1];
  return null;
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

export function syncItemStrings(item: CardItem, mats: CardMaterial[]): void {
  item.varilla = mats.filter(m => m.type === 'V').map(m => `${m.qty}x${m.cm}`).join(' ') || undefined;
  item.larguero = mats.filter(m => m.type === 'L').map(m => `${m.qty}x${m.cm}`).join(' ') || undefined;
  item.travesaño = mats.filter(m => m.type === 'T').map(m => `${m.qty}x${m.cm}`).join(' ') || undefined;
}

export function parse2DItem(desc: string): { w: number; h: number; label: string } | null {
  const m = desc.match(/(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const w = parseFloat(m[1].replace(',', '.'));
  const h = parseFloat(m[2].replace(',', '.'));
  const rest = desc.replace(m[0], '').replace(/bastidor|cm|["]/gi, '').trim();
  return { w, h, label: rest || 'Marco' };
}

function largueroCount(longer: number): number {
  if (longer < 90) return 0;
  if (longer >= 90 && longer <= 129) return 1;
  if (longer >= 130 && longer < 201) return 2;
  return 3;
}

function filaCount(shorter: number): number {
  if (shorter < 90) return 0;
  if (shorter >= 90 && shorter <= 129) return 1;
  return 2;
}

export function computeLarCm(shorter: number): number {
  return Math.round((shorter - 5.2) * 10) / 10;
}

export function computeTravCm(longer: number, largueros: number, filas: number): number {
  if (largueros <= 0 || filas <= 0) return 0;
  const divisiones = largueros + 1;
  const descuento = largueros === 1 ? 9.0 : largueros === 2 ? 12.8 : 16.5;
  return Math.trunc(((longer - descuento) / divisiones) * 10) / 10;
}

export interface MolduraFormula {
  varillas: CardMaterial[];
  largueros: CardMaterial[];
  travesanos: CardMaterial[];
  larguero_count: number;
  filas: number;
  larguero_cm: number;
  travesano_cm: number;
}

export function getMolduraFormula(w: number, h: number, qty: number = 1): MolduraFormula {
  const longer = Math.max(w, h);
  const shorter = Math.min(w, h);
  const largueros = largueroCount(longer);
  const filas = filaCount(shorter);
  const larguero_cm = computeLarCm(shorter);

  const varillas: CardMaterial[] = [
    { type: 'V', qty: 2 * qty, cm: w },
    { type: 'V', qty: 2 * qty, cm: h },
  ];

  const largueroMats: CardMaterial[] = [];
  const travesanoMats: CardMaterial[] = [];
  let travesano_cm = 0;

  if (largueros > 0) {
    largueroMats.push({ type: 'L', qty: largueros * qty, cm: larguero_cm });
    if (filas > 0) {
      travesano_cm = computeTravCm(longer, largueros, filas);
      travesanoMats.push({ type: 'T', qty: filas * (largueros + 1) * qty, cm: travesano_cm });
    }
  }

  return {
    varillas,
    largueros: largueroMats,
    travesanos: travesanoMats,
    larguero_count: largueros,
    filas,
    larguero_cm,
    travesano_cm,
  };
}

export function calcMaterials(w: number, h: number, qty: number): CardMaterial[] {
  const { varillas, largueros, travesanos } = getMolduraFormula(w, h, qty);
  return [...varillas, ...largueros, ...travesanos];
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

export interface LayoutCard {
  item: MeasurableCard;
  idx: number;
}

export interface PagedPage {
  left: LayoutCard[];
  right: LayoutCard[];
}

function cardHeightAt(c: LayoutCard, heights: number[]): number {
  const m = heights[c.idx];
  return m !== undefined && m > 0 ? m : colHeight(c.item);
}

export function columnHeight(list: LayoutCard[], heights: number[]): number {
  const sum = list.reduce((s, c) => s + cardHeightAt(c, heights), 0);
  return sum + (list.length > 0 ? (list.length - 1) * CARD_GAP : 0);
}

export function buildPagedLayout(cards: MeasurableCard[], heights: number[]): PagedPage[] {
  const indexed: LayoutCard[] = cards
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => cardHeightAt(b, heights) - cardHeightAt(a, heights) || a.idx - b.idx);

  const pages: PagedPage[] = [];

  for (const c of indexed) {
    const cardH = cardHeightAt(c, heights);

    if (cardH > PAGE_HEIGHT) {
      pages.push({ left: [c], right: [] });
      continue;
    }

    let best: { page: PagedPage; col: 'left' | 'right'; leftover: number } | null = null;
    for (const page of pages) {
      for (const col of ['left', 'right'] as const) {
        const used = columnHeight(page[col], heights);
        const gap = page[col].length > 0 ? CARD_GAP : 0;
        const total = used + gap + cardH;
        if (total > PAGE_HEIGHT) continue;
        const leftover = PAGE_HEIGHT - total;
        if (!best || leftover < best.leftover || (leftover === best.leftover && col === 'left')) {
          best = { page, col, leftover };
        }
      }
    }

    if (best) {
      best.page[best.col].push(c);
    } else {
      pages.push({ left: [c], right: [] });
    }
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
    if (isCirculoDesc(desc)) return true;
    if (/promo/i.test(desc) && /promo[^0-9]*\d+\s*[xX×]\s*\d+/i.test(desc)) return true;
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

    if (isCirculoDesc(desc)) {
      items.push({
        cantidad: it.cantidad,
        medida: parseCirculoMedida(desc),
        tipo: 'Círculo',
        isCirculo: true,
      });
      continue;
    }

    // Promo: promo siempre es N x M + medida de bastidor en cualquier token de la descripción
    if (/promo/i.test(desc)) {
      const promoM = desc.match(/promo[^0-9]*(\d+)\s*[xX×]\s*(\d+)/i);
      const effQty = parsePromoBastidores(desc, it.cantidad);
      const dims = extractBastidorDimsFromDesc(desc);
      if (effQty !== null && dims) {
        const mats = calcMaterials(dims.w, dims.h, effQty);
        const promoLabel = promoM ? `Promo ${promoM[1]}x${promoM[2]}` : 'Promo';
        let cleaned = desc.replace(/promo[^0-9]*\d+\s*[xX×]\s*\d+/gi, ' ');
        cleaned = cleaned.replace(new RegExp(`${dims.w}\\s*[xX]\\s*${dims.h}`, 'i'), ' ');
        cleaned = cleaned.replace(/bastidor|cm|["]/gi, ' ').replace(/\s+/g, ' ').trim();
        const tipoLabel = cleaned ? `${promoLabel} · ${cleaned}` : promoLabel;
        items.push({
          cantidad: effQty,
          medida: `${dims.w}x${dims.h}`,
          tipo: tipoLabel,
          varilla: mats.filter(m => m.type === 'V').map(m => `${m.qty}x${m.cm}`).join(' ') || undefined,
          larguero: mats.filter(m => m.type === 'L').map(m => `${m.qty}x${m.cm}`).join(' ') || undefined,
          travesaño: mats.filter(m => m.type === 'T').map(m => `${m.qty}x${m.cm}`).join(' ') || undefined,
        });
        allMats.push(...mats);
        continue;
      }
      if (effQty !== null) {
        // Promo sin medida bastidor válida: mostrar como producto a hacer sin materiales pero con cantidad efectiva
        const promoLabel2 = promoM ? `Promo ${promoM[1]}x${promoM[2]}` : 'Promo';
        items.push({
          cantidad: effQty,
          medida: desc,
          tipo: promoLabel2,
          isNonMolding: true,
        });
        continue;
      }
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

function parseFirstQty(s?: string): number {
  if (!s) return 0;
  const first = s.split(' ')[0];
  const q = parseFloat(first.split('x')[0]);
  return isNaN(q) ? 0 : q;
}

export function getCortesVarilla(item: {
  medida: string;
  cantidad: number;
  larguero?: string;
  travesaño?: string;
}): { larga: number; corta: number } | null {
  const m = item.medida.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  const longer = Math.max(w, h);
  const shorter = Math.min(w, h);
  const qty = item.cantidad || 1;

  let largueros = largueroCount(longer);
  let filas = filaCount(shorter);

  if (item.larguero !== undefined) {
    largueros = Math.max(0, Math.round(parseFirstQty(item.larguero) / qty));
  }
  if (item.travesaño !== undefined) {
    filas = largueros > 0 ? Math.max(0, Math.round(parseFirstQty(item.travesaño) / (largueros + 1) / qty)) : 0;
  }

  return { larga: largueros, corta: filas };
}

export function calcLargueros(longer: number): number {
  return largueroCount(longer);
}

export function calcFilas(shorter: number): number {
  return filaCount(shorter);
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

const CARD_CSS = `
.card { break-inside: avoid; page-break-inside: avoid; border: 4px solid #000; background: #fff; font-family: Arial, sans-serif; line-height: normal; }
.header { background: #000; color: #fff; text-align: center; }
.client-name { font-size: 26px; font-weight: 900; line-height: 1; text-transform: uppercase; margin-bottom: 3px; }
.order-id { font-size: 14px; color: #ddd; }
.summary-table { width: 100%; border-collapse: collapse; background: #eee; border-bottom: 3px solid #000; }
.summary-table td { padding: 2px; border: 1px solid #444; vertical-align: middle; }
.sum-qty { font-size: 32px; font-weight: 900; text-align: center; display: block; }
.sum-dim { font-size: 24px; font-weight: 900; margin-right: 8px; }
.sum-type { font-size: 18px; font-weight: bold; text-transform: uppercase; color: #444; }
.sum-cortes { font-size: 14px; font-weight: 600; color: #555; line-height: 1.2; }
.sum-c-l { color: #27ae60; font-weight: 700; }
.sum-c-c { color: #d35400; font-weight: 700; }
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
.tajos { color: #2c3e50; font-weight: 800; font-size: 15px; }
.tajos-cell { background: #ebf5fb; }
`;

const MEASURE_CSS = `
.mol-measure { font-family: Arial, sans-serif; font-size: 16px; line-height: normal; }
.mol-measure * { box-sizing: border-box; margin: 0; padding: 0; }
.mol-measure .card { break-inside: avoid; page-break-inside: avoid; border: 4px solid #000; background: #fff; font-family: Arial, sans-serif; line-height: normal; }
.mol-measure .header { background: #000; color: #fff; text-align: center; }
.mol-measure .client-name { font-size: 26px; font-weight: 900; line-height: 1; text-transform: uppercase; margin-bottom: 3px; }
.mol-measure .order-id { font-size: 14px; color: #ddd; }
.mol-measure .summary-table { width: 100%; border-collapse: collapse; background: #eee; border-bottom: 3px solid #000; }
.mol-measure .summary-table td { padding: 2px; border: 1px solid #444; vertical-align: middle; }
.mol-measure .sum-qty { font-size: 32px; font-weight: 900; text-align: center; display: block; }
.mol-measure .sum-dim { font-size: 24px; font-weight: 900; margin-right: 8px; }
.mol-measure .sum-type { font-size: 18px; font-weight: bold; text-transform: uppercase; color: #444; }
.mol-measure .sum-cortes { font-size: 14px; font-weight: 600; color: #555; line-height: 1.2; }
.mol-measure .sum-c-l { color: #27ae60; font-weight: 700; }
.mol-measure .sum-c-c { color: #d35400; font-weight: 700; }
.mol-measure .mat-table { width: 100%; border-collapse: collapse; text-align: center; }
.mol-measure .mat-table th { border: 1px solid #000; padding: 2px; font-size: 18px; font-weight: 900; text-transform: uppercase; }
.mol-measure .mat-table td { border: 1px solid #000; padding: 0; height: 30px; }
.mol-measure .th-var { background: #2c3e50; color: #fff; }
.mol-measure .td-var { background: #ebf5fb; }
.mol-measure .th-lar { background: #27ae60; color: #fff; }
.mol-measure .td-lar { background: #e9f7ef; }
.mol-measure .th-tra { background: #d35400; color: #fff; }
.mol-measure .td-tra { background: #fdf2e9; }
.mol-measure .val-cell { font-weight: 900; font-size: 26px; line-height: 1; }
.mol-measure .tajos { color: #2c3e50; font-weight: 800; font-size: 15px; }
.mol-measure .tajos-cell { background: #ebf5fb; }
`;

export interface MatRow {
  varilla: { qty: number; cm: number };
  larguero?: { qty: number; cm: number };
  travesano?: { qty: number; cm: number };
  arrow?: boolean;
  tajos?: number;
}

export function buildMatRowsData(card: MeasurableCard): MatRow[] {
  const rows: MatRow[] = [];
  const matItems = card.items.filter(it => (!it.isNonMolding && !it.isCirculo) || it.isTapacanto);
  for (const item of matItems) {
    const dims = item.medida.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
    if (!dims) continue;
    const w = parseFloat(dims[1]), h = parseFloat(dims[2]);
    const parse = (s?: string) => (s ?? '').split(' ').filter(Boolean).map(x => {
      const [q, c] = x.split('x'); return { qty: parseInt(q), cm: parseFloat(c) };
    });
    const vs = parse(item.varilla);
    const ls = parse(item.larguero);
    const ts = parse(item.travesaño);
    const cortes = getCortesVarilla(item);
    const tajosLarga = cortes?.larga ?? 0;
    const tajosCorta = cortes?.corta ?? 0;
    vs.forEach((v, i) => {
      const isLongerVar = (w > h && i === 0) || (w < h && i === 1) || (w === h && i === 1);
      if (isLongerVar) {
        rows.push({ varilla: v, larguero: ls[0], tajos: tajosLarga });
      } else {
        rows.push({ varilla: v, travesano: ts[0], arrow: true, tajos: tajosCorta });
      }
    });
  }
  return rows;
}

function buildMatRows(card: MeasurableCard): string {
  const rows = buildMatRowsData(card);
  if (rows.length === 0) {
    const hasOnlyCirculos = card.items.some(it => it.isCirculo) && card.items.filter(it => !it.isNonMolding || it.isTapacanto || it.isCirculo).every(it => it.isCirculo);
    if (hasOnlyCirculos) {
      return `<tr><td colspan='6' style='padding:6px;font-size:14px;color:#666;text-align:center;'>Círculo — sin materiales</td></tr>`;
    }
    return '<tr><td class="td-var val-cell"></td><td class="td-var val-cell"></td><td class="td-lar val-cell"></td><td class="td-lar val-cell"></td><td class="td-tra val-cell"></td><td class="td-tra val-cell"></td></tr>';
  }
  const tajosCell = (n?: number) => (n !== undefined && n > 0 ? `<span class='tajos'>Tajos: ${n}</span>` : ``);
  const larRows = rows.filter(r => !r.arrow).map(r => `<tr>
      <td class='td-var val-cell'>${r.varilla.qty}</td><td class='td-var val-cell'>${r.varilla.cm}</td>
      <td class='td-lar val-cell'>${r.larguero ? r.larguero.qty : ''}</td><td class='td-lar val-cell'>${r.larguero ? r.larguero.cm : ''}</td>
      <td class='td-tra tajos-cell' colspan='2'>${tajosCell(r.tajos)}</td>
    </tr>`);
  const travRows = rows.filter(r => r.arrow).map(r => `<tr>
      <td class='td-var val-cell'>${r.varilla.qty}</td><td class='td-var val-cell'>${r.varilla.cm}</td>
      <td class='td-lar tajos-cell' colspan='2'>${tajosCell(r.tajos)}</td>
      <td class='td-tra val-cell'>${r.travesano ? r.travesano.qty : ''}</td><td class='td-tra val-cell'>${r.travesano ? r.travesano.cm : ''}</td>
    </tr>`);
  return [...larRows, ...travRows].join('');
}

export function renderSingleCardHtml(card: MeasurableCard, idx: number, side: 'left' | 'right' = 'left'): string {
  const cliente = card.cliente.length > 25 ? card.cliente.slice(0, 25) : card.cliente;
  const validItems = card.items.filter(it => !it.isNonMolding || it.isTapacanto || it.isCirculo);
  const summaryRows = validItems.map(it => {
    return `
        <tr>
          <td width='15%'><span class='sum-qty'>${it.cantidad}</span></td>
          <td width='35%'><span class='sum-dim'>${it.medida}</span></td>
          <td width='50%'><span class='sum-type'>${it.tipo}</span></td>
        </tr>`;
  }).join('');

  const square = side === 'right'
    ? `<div style='flex:1;'><div class='client-name'>${cliente}</div><div class='order-id'>${card.num}</div></div><div style='background:#fff;width:54px;height:45px;border-radius:4px;flex-shrink:0;margin-left:10px;'></div>`
    : `<div style='background:#fff;width:54px;height:45px;border-radius:4px;flex-shrink:0;margin-right:10px;'></div><div style='flex:1;'><div class='client-name'>${cliente}</div><div class='order-id'>${card.num}</div></div>`;

  const matBody = buildMatRows(card);

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

export interface MeasurableCard {
  cliente: string;
  num: string;
  items: CardItem[];
  materials: CardMaterial[];
}

export async function measureCardHeights(cards: MeasurableCard[]): Promise<number[]> {
  if (typeof document === 'undefined') return [];
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;visibility:hidden;width:${PDF_COLUMN_WIDTH_PX}px;left:-9999px;top:0;z-index:-1;`;
  const style = document.createElement('style');
  style.textContent = MEASURE_CSS;
  host.appendChild(style);
  const wrap = document.createElement('div');
  wrap.className = 'mol-measure';
  wrap.innerHTML = cards.map((c, i) => renderSingleCardHtml(c, i)).join('');
  host.appendChild(wrap);
  document.body.appendChild(host);
  try {
    await document.fonts.ready;
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const els = host.querySelectorAll('.card');
    const heights: number[] = [];
    els.forEach(el => {
      const idx = parseInt((el as HTMLElement).dataset.cardIdx ?? '-1');
      if (idx >= 0) heights[idx] = (el as HTMLElement).offsetHeight;
    });
    return heights;
  } finally {
    host.remove();
  }
}

const PDF_BASE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 16px; line-height: normal; }
.page { width: 210mm; padding: 5px; page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
.grid { display: flex; gap: 10px; width: 100%; }
.col-left, .col-right { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
${CARD_CSS}
`;

function buildPagedMoldurasHtml(cards: MeasurableCard[], heights: number[]): string {
  const pages = buildPagedLayout(cards, heights);
  let pagesHtml = '';
  for (const page of pages) {
    const leftHtml = page.left.map(c => renderSingleCardHtml(c.item, c.idx, 'left')).join('');
    const rightHtml = page.right.map(c => renderSingleCardHtml(c.item, c.idx, 'right')).join('');
    pagesHtml += `<div class="page"><div class="grid"><div class="col-left">${leftHtml}</div><div class="col-right">${rightHtml}</div></div></div>`;
  }
  return `<html><head><meta charset='utf-8'><style>${PDF_BASE_CSS}</style></head><body>${pagesHtml}</body></html>`;
}

export function buildMoldurasHtmlPaged(cards: MeasurableCard[], heights?: number[]): string {
  return buildPagedMoldurasHtml(cards, heights ?? []);
}
