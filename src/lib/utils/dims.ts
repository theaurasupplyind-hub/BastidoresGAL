// Reordena el primer par de medidas de un texto para que quede "mayor x menor",
// preservando el separador, los espacios y la notación decimal originales.
// A diferencia de normalizeText (precios.ts) NO baja a minúsculas ni quita
// acentos: acá el texto es visible para el usuario y se persiste tal cual.

const PAIR =
  /(\d+(?:[.,]\d+)?)(\s*[xX*×]\s*)(\d+(?:[.,]\d+)?)((?:\s*[xX*×]\s*\d+(?:[.,]\d+)?)*)/g;

function toNum(raw: string): number {
  return parseFloat(raw.replace(',', '.'));
}

export function sortDimsDesc(text: string): string {
  if (!text) return text;
  return text.replace(
    PAIR,
    (_m, a: string, sep: string, b: string, rest: string) => {
      const d1 = toNum(a);
      const d2 = toNum(b);
      if (isNaN(d1) || isNaN(d2) || d1 >= d2) return _m;
      return `${b}${sep}${a}${rest}`;
    },
  );
}
