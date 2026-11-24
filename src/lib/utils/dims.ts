// Reordena el primer par de medidas de un texto para que quede "menor x mayor",
// preservando el separador, los espacios y la notación decimal originales.
// A diferencia de normalizeText (precios.ts) NO baja a minúsculas ni quita
// acentos: acá el texto es visible para el usuario y se persiste tal cual.

const PAIR =
  /(\d+(?:[.,]\d+)?)(\s*[xX*×]\s*)(\d+(?:[.,]\d+)?)((?:\s*[xX*×]\s*\d+(?:[.,]\d+)?)*)/g;

// Un "Promo N x M" no es una medida: N es la cantidad de bastidores por unidad
// (ej. "Promo 23 x 1"). Invertirlo cambia el cálculo de materiales, así que el
// par que viene justo después de la palabra "promo" se deja intacto.
const PROMO_PREFIX = /promo[^\d]*$/i;

function toNum(raw: string): number {
  return parseFloat(raw.replace(',', '.'));
}

function sortPairs(text: string, protectPromo: boolean): string {
  if (!text) return text;
  return text.replace(
    PAIR,
    (_m: string, a: string, sep: string, b: string, rest: string, offset: number, full: string) => {
      if (protectPromo && PROMO_PREFIX.test(full.slice(0, offset))) return _m;
      const d1 = toNum(a);
      const d2 = toNum(b);
      if (isNaN(d1) || isNaN(d2) || d1 <= d2) return _m;
      return `${b}${sep}${a}${rest}`;
    },
  );
}

// Texto visible: respeta las promos para no romper su significado.
export function sortDimsAsc(text: string): string {
  return sortPairs(text, true);
}

// Clave canónica para dedup de catálogo: ordena TODOS los pares, incluidos los
// de promo, para que una promo guardada históricamente como "Promo 1 x 23" y
// la misma escrita hoy como "Promo 23 x 1" no creen productos duplicados.
export function sortAllDimsAsc(text: string): string {
  return sortPairs(text, false);
}
