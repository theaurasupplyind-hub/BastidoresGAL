import type { Provider, Employee } from '$lib/types';

function normalizeText(text: string): string {
  let t = text.toLowerCase().trim();
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

export interface ParsedExpense {
  amount: number;
  type: 'PAYMENT' | 'PURCHASE' | 'EMPLOYEE_PAYMENT' | 'GENERAL';
  entityType: 'PROVIDER' | 'EMPLOYEE' | null;
  entityId: number | null;
  entityName: string | null;
  description: string;
}

export interface Suggestion {
  type: 'provider' | 'employee' | 'template' | 'category';
  label: string;
  subtitle: string;
  appendText: string;
}

const COMMON_CATEGORIES = ['luz', 'agua', 'internet', 'alquiler', 'gas', 'limpieza', 'seguro', 'impuesto', 'flete', 'envio', 'comida', 'transporte'];

export function extractAmount(text: string): { amount: number; remaining: string } | null {
  const costMatch = text.match(/costo\s+(\d[\d.,]*)/i);
  if (costMatch) {
    const amount = parseFloat(costMatch[1].replace(/\./g, '').replace(',', '.'));
    if (!isNaN(amount) && amount > 0) {
      const remaining = text.replace(costMatch[0], '').trim();
      return { amount, remaining };
    }
  }

  const numMatch = text.match(/(\d[\d.,]*)/);
  if (numMatch) {
    let amountStr = numMatch[1].replace(/\./g, '');
    amountStr = amountStr.replace(',', '.');
    const amount = parseFloat(amountStr);
    if (!isNaN(amount) && amount > 0) {
      const remaining = text.replace(numMatch[1], '').trim();
      return { amount, remaining };
    }
  }

  return null;
}

export function detectExpenseType(text: string): { type: ParsedExpense['type']; remaining: string } {
  const lower = text.toLowerCase();

  if (/\b(sueldo|salario)\b/.test(lower)) {
    const remaining = text.replace(/\b(sueldo|salario)\b/gi, '').replace(/\s+/g, ' ').trim();
    return { type: 'EMPLOYEE_PAYMENT', remaining };
  }

  if (/\bcompra\b/i.test(lower)) {
    const remaining = text.replace(/\bcompra\b/gi, '').replace(/\s+/g, ' ').trim();
    return { type: 'PURCHASE', remaining };
  }

  if (/\b(pago\s+a\s+proveedor|proveedor)\b/i.test(lower)) {
    const remaining = text.replace(/\b(pago\s+a\s+proveedor|proveedor|pago\s+a)\b/gi, '').replace(/\s+/g, ' ').trim();
    return { type: 'PAYMENT', remaining };
  }

  if (/\bpago\b/i.test(lower)) {
    const remaining = text.replace(/\bpago\b/gi, '').replace(/\s+/g, ' ').trim();
    return { type: 'PAYMENT', remaining };
  }

  return { type: 'GENERAL', remaining: text };
}

export function fuzzyMatchEntities(
  query: string,
  providers: Provider[],
  employees: Employee[],
  preferType?: 'PROVIDER' | 'EMPLOYEE'
): Array<{ id: number; name: string; type: 'PROVIDER' | 'EMPLOYEE'; score: number }> {
  const q = normalizeText(query);
  if (!q || q.length < 1) return [];

  const results: Array<{ id: number; name: string; type: 'PROVIDER' | 'EMPLOYEE'; score: number }> = [];

  const scoreEntity = (name: string): number => {
    const n = normalizeText(name);
    if (!n) return 0;
    let score = 0;
    if (q === n) score = 100;
    else if (n.startsWith(q)) score = 80;
    else if (n.includes(q)) score = 60;
    else {
      const qTokens = q.split(/\s+/);
      const nTokens = n.split(/\s+/);
      const common = qTokens.filter(t => nTokens.some(nt => nt.includes(t) || t.includes(nt)));
      score = common.length * 20;
    }
    return score;
  };

  for (const p of providers) {
    const score = scoreEntity(p.name);
    if (score > 0) results.push({ id: p.id, name: p.name, type: 'PROVIDER', score });
  }
  for (const e of employees) {
    if (!e.active) continue;
    const score = scoreEntity(e.name);
    if (score > 0) results.push({ id: e.id, name: e.name, type: 'EMPLOYEE', score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 6);
}

export function parseExpense(text: string, providers: Provider[], employees: Employee[]): ParsedExpense {
  const trimmed = text.trim();
  if (!trimmed) {
    return { amount: 0, type: 'GENERAL', entityType: null, entityId: null, entityName: null, description: '' };
  }

  const amountResult = extractAmount(trimmed);
  const amount = amountResult?.amount ?? 0;
  let remaining = amountResult?.remaining ?? trimmed;

  const { type, remaining: typeRemaining } = detectExpenseType(remaining);
  remaining = typeRemaining;

  remaining = remaining.replace(/\b(a|de|el|la|los|las|del|al|por|para|con|en|un|una)\b/gi, '').replace(/\s+/g, ' ').trim();

  let entityType: 'PROVIDER' | 'EMPLOYEE' | null = null;
  let entityId: number | null = null;
  let entityName: string | null = null;

  const preferType = type === 'EMPLOYEE_PAYMENT' ? 'EMPLOYEE' : (type === 'PURCHASE' || type === 'PAYMENT') ? 'PROVIDER' : undefined;
  const matches = fuzzyMatchEntities(remaining, providers, employees, preferType);

  if (matches.length > 0 && matches[0].score >= 20) {
    entityType = matches[0].type;
    entityId = matches[0].id;
    entityName = matches[0].name;
    const entityNorm = normalizeText(matches[0].name);
    const nameTokens = entityNorm.split(/\s+/);
    let desc = remaining;
    for (const tok of nameTokens) {
      desc = desc.replace(new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
    }
    remaining = desc.replace(/\s+/g, ' ').trim();
  }

  const description = remaining || (
    type === 'PAYMENT' ? 'Pago' :
    type === 'PURCHASE' ? 'Compra' :
    type === 'EMPLOYEE_PAYMENT' ? 'Sueldo' : 'Gasto'
  );

  return {
    amount,
    type,
    entityType,
    entityId,
    entityName,
    description: description.charAt(0).toUpperCase() + description.slice(1),
  };
}

export function getSuggestions(
  text: string,
  providers: Provider[],
  employees: Employee[]
): Suggestion[] {
  const trimmed = text.trim();
  const suggestions: Suggestion[] = [];

  if (!trimmed) {
    return [
      { type: 'template', label: 'Pago de sueldo a [empleado]', subtitle: 'Registrar sueldo', appendText: 'pago de sueldo a ' },
      { type: 'template', label: 'Pago a proveedor [nombre]', subtitle: 'Pagar deuda a proveedor', appendText: 'pago a proveedor ' },
      { type: 'template', label: 'Compra a [proveedor], costo [$]', subtitle: 'Nueva compra a proveedor', appendText: 'compra a , costo ' },
      { type: 'template', label: 'Gasto [descripción]', subtitle: 'Gasto general', appendText: 'gasto ' },
    ];
  }

  const amountResult = extractAmount(trimmed);
  const remaining = amountResult?.remaining ?? trimmed;

  const lowerCheck = remaining.toLowerCase();
  const expectingEmployee = /\b(sueldo|salario)\s*(a\s+)?$/i.test(remaining) || /\b(pago\s+de\s+sueldo)\s*(a\s+)?$/i.test(remaining);
  const expectingProvider = /\b(pago\s+a\s+proveedor|proveedor|pago\s+a)\s*$/i.test(remaining) || /\bcompra\s*(a\s+)?$/i.test(remaining);

  if (expectingEmployee) {
    const query = remaining.replace(/\b(sueldo|salario|empleado|pago\s+de\s+sueldo|a)\b/gi, '').trim();
    const matches = fuzzyMatchEntities(query, [], employees);
    for (const m of matches) {
      suggestions.push({
        type: 'employee',
        label: m.name,
        subtitle: `Empleado · ${employees.find(e => e.id === m.id)?.job_type || ''}`,
        appendText: m.name + ' ',
      });
    }
  } else if (expectingProvider) {
    const query = remaining.replace(/\b(pago\s+a\s+proveedor|proveedor|pago\s+a|compra|a)\b/gi, '').trim();
    const matches = fuzzyMatchEntities(query, providers, []);
    for (const m of matches) {
      suggestions.push({
        type: 'provider',
        label: m.name,
        subtitle: `Proveedor · ${providers.find(p => p.id === m.id)?.cuit || ''}`,
        appendText: m.name + ' ',
      });
    }
  } else {
    const matches = fuzzyMatchEntities(remaining, providers, employees);
    for (const m of matches) {
      if (m.type === 'PROVIDER') {
        suggestions.push({
          type: 'provider',
          label: m.name,
          subtitle: `Proveedor · ${providers.find(p => p.id === m.id)?.cuit || ''}`,
          appendText: m.name + ' ',
        });
      } else {
        suggestions.push({
          type: 'employee',
          label: m.name,
          subtitle: `Empleado · ${employees.find(e => e.id === m.id)?.job_type || ''}`,
          appendText: m.name + ' ',
        });
      }
    }

    if (matches.length === 0) {
      const q = normalizeText(remaining);
      for (const cat of COMMON_CATEGORIES) {
        if (cat.includes(q) || q.includes(cat) || q.length < 2) {
          suggestions.push({
            type: 'category',
            label: cat.charAt(0).toUpperCase() + cat.slice(1),
            subtitle: 'Categoría de gasto',
            appendText: cat + ' ',
          });
        }
      }
    }
  }

  return suggestions.slice(0, 6);
}

export const EXPENSE_TYPE_LABELS: Record<ParsedExpense['type'], string> = {
  PAYMENT: 'Pago a Proveedor',
  PURCHASE: 'Compra',
  EMPLOYEE_PAYMENT: 'Sueldo',
  GENERAL: 'Gasto General',
};
