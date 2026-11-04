# Fórmulas de precio: operación, condiciones y redondeo

Especificación para reimplementar el cálculo de precio de una regla de precios.
No describe la UI ni el asistente: solo **cómo se obtiene el precio final** a
partir de una descripción, una lista de precios base y una regla.

- **Fuente de verdad:** `src/lib/utils/precios.ts` (`suggestPrice`, `evaluateRules`)
  y `src/lib/types/index.ts` (`PricingRule`, `RuleCondition`).
- **Datos verificados contra:** `https://api-bastidores.onrender.com` el 2026-11-03.
- **Moneda:** pesos argentinos, enteros. Todos los porcentajes se redondean a peso
  entero en cada paso.

---

## 1. Resumen del cálculo

```text
texto del usuario
   ↓ parseo (medidas + grosor)
regla (por tokens)  +  precio base (categoría/variante/medida)
   ↓
operación        → modifica el precio base
condiciones      → suman/restan en orden, acumulativo
redondeo         → una sola vez, al final
   ↓
precio final
```

Cada regla habilitada que matchea produce **su propio** precio. No hay prioridad
entre reglas: si dos matchean, hay dos sugerencias. El consumidor decide cuál usar
(el asistente toma la primera con `suggested: true`).

---

## 2. Datos de entrada

### 2.1 Precio base (`PrecioReferencia`)

```json
{
  "id": 1642,
  "categoria": "BASTIDOR",
  "medida": "30 x 40",
  "variante": "Sin Tela",
  "precio": 14000
}
```

La medida es texto `"<menor> x <mayor>"` en centímetros. No todas las categorías
tienen medidas: `ACRILICO` usa `"125cc"`, `"250cc"`, y esas filas no sirven como
base de una regla de medida.

### 2.2 Regla de precio (`PricingRule`)

Tal como la devuelve `GET /pricing-rules` (**snake_case**, y `match_tokens` y
`conditions` son **strings con JSON adentro**, no arrays):

```json
{
  "id": 107,
  "name": "Pinturas",
  "match_tokens": "[\"pintura\",\"embastado\",\"embastar\"]",
  "base_categoria": "BASTIDOR",
  "base_variante": "Sin Tela",
  "operation": "percentage",
  "operation_value": 10.0,
  "conditions": "[{\"field\":\"grosor\",\"operator\":\">=\",\"value\":2,\"adjustmentType\":\"percentage\",\"adjustmentValue\":10}]",
  "enabled": true,
  "rounding": 1000
}
```

Equivalente ya normalizado:

```ts
interface PricingRule {
  name: string;
  matchTokens: string[];
  baseCategoria: string;
  baseVariante: string;
  operation: 'direct' | 'percentage' | 'fixed' | 'override';
  operationValue: number;
  conditions: RuleCondition[];
  enabled: boolean;
  rounding: number;            // 0 = sin redondeo; negativo = hacia arriba
}

interface RuleCondition {
  field: 'grosor' | 'lado_mayor' | 'lado_menor';
  operator: '>' | '>=' | '<' | '<=' | '==';
  value: number;
  adjustmentType: 'percentage' | 'fixed';
  adjustmentValue: number;
}
```

`enabled: false` ⇒ la regla se ignora por completo.

---

## 3. Parseo del texto (lo mínimo que afecta al precio)

### 3.1 Normalización

1. Minúsculas, sin acentos, espacios colapsados.
2. Separadores de medida unificados: `x`, `X`, `*`, `×` → `x`.
3. Se detectan hasta tres números: `A x B` o `A x B x G`.

### 3.2 Metros → centímetros

Cada par `(d1, d2)` se convierte antes de comparar:

```text
si d1 < 12 y d2 < 12        → (d1*100, d2*100)   // "1,5 x 3"  → 150 x 300
si d1 < 12 y d2 > 50        → (d1*100, d2)       // "1,5 x 300" → 150 x 300
si d2 < 12 y d1 > 50        → (d1, d2*100)
si no                       → (d1, d2)
```

Luego se ordena el par: `(menor, mayor)`.

### 3.3 Grosor

El tercer número es el grosor y **no se convierte a cm**:

```text
"40 x 50 x 5"   → medida 40x50, grosor 5
"67 x 67 x 3"   → medida 67x67, grosor 3
"1,5 x 3 x 5"   → medida 150x300, grosor 5
```

Sin medidas (`dims` vacío) no hay sugerencia: se devuelve lista vacía.

---

## 4. Cómo se elige la regla (resumen)

Si el otro programa ya sabe qué regla aplicar, esta sección se puede omitir.

Una regla matchea si alguno de sus **tokens** (`match_tokens` + `name`) aparece en
el texto normalizado. Se queda con el **mayor score**:

| Situación | Score |
|---|---|
| Frase o token exacto | 100 |
| Igual salvo singular/plural, o pegado (`"sintela"` = `"sin tela"`) | 90 |
| Frase del token contenida en el texto | 80 |
| Misma frase sin espacios contenida | 78 |
| Token "pegado" corto (≤ 3 letras) | 70 |
| Prefijo en cualquier sentido (`"pi"` → `"pintura"`) | 60 + largo, tope 79 |
| Inicial suelta **solo si hay medidas** (`"90x87 p"`) | 55 |

Los tokens de enlace (`de, del, la, el, los, las, con, sin, para, por, y, o, en,
al, un, una`) no identifican una regla por sí solos.

> **Riesgo real:** un token corto como `"ta"` (regla *Tapiz*) matchea por prefijo
> cualquier palabra que empiece con "ta". Evitá tokens de 1–2 letras.

---

## 5. Cómo se elige el precio base

Dentro de las referencias con `categoria = base_categoria` y
`variante = base_variante`:

1. **Redondear cada eje** de la medida consultada (ya en cm y ordenada):

```text
roundDim(v):
  rem = v mod 10
  si rem <= 3 → floor(v/10)*10      // 42 → 40 ; 67 → 70
  si rem >= 4 → ceil(v/10)*10
```

| Consulta | Eje redondeado |
|---|---|
| 42 | 40 |
| 67 | 70 |
| 105 | 110 |
| 300 | 300 |

2. **Match exacto** del par redondeado contra `medida` de la referencia.
3. Si no hay exacto: la referencia con **perímetro más cercano**, donde
   `perimetro = 2 * (menor + mayor)`. No interpola: toma el precio de esa fila tal
   cual.
4. Si la categoría o la variante no existen, **la regla no produce precio**.

> **Ojo:** `base_variante` vacía **no** significa "todas las variantes". El filtro
> es igualdad estricta (`variante === ''`), así que solo toma referencias sin
> variante. Esto difiere de las reglas de estimación, donde variante vacía sí
> significa "todas".

---

## 6. Las fórmulas

Sea `P` el precio base encontrado.

### 6.1 Operación

| `operation` | Fórmula | `operation_value` |
|---|---|---|
| `direct` | `P` | se ignora |
| `percentage` | `P + round(P * value / 100)` | 10 = +10%, −50 = −50% |
| `fixed` | `P + value` | pesos, puede ser negativo |
| `override` | `value` | reemplaza el precio base |

`round` es redondeo a peso entero (`Math.round`). El porcentaje se calcula sobre
el precio **en ese momento**, no sobre el base original.

### 6.2 Condiciones

Se evalúan **en el orden del array**, todas las que se cumplan, de forma
**acumulativa** sobre el precio ya modificado por la operación y por las
condiciones anteriores.

Valor real de cada campo:

| `field` | Valor |
|---|---|
| `grosor` | tercer número del texto (sin convertir); `null` si no vino |
| `lado_mayor` | `max(menor, mayor)` de la medida ya en cm |
| `lado_menor` | `min(menor, mayor)` de la medida ya en cm |

Si el campo es `null`, la condición **no se cumple**.

```text
si campo OP value se cumple:
  si adjustmentType == "percentage" → P = P + round(P * adjustmentValue / 100)
  si adjustmentType == "fixed"      → P = P + adjustmentValue
```

### 6.3 Redondeo final

Se aplica **una sola vez**, después de operación y condiciones, y solo si
`rounding !== 0` y `P > 0`.

```text
roundPrice(P, rounding):
  step = |rounding|
  si step <= 0 → P

  si rounding < 0 → ceil(P / step) * step        // siempre hacia arriba

  half = step / 2
  rem  = P mod step
  si rem > half → ceil(P / step) * step          // hacia arriba
  si no         → floor(P / step) * step         // hacia abajo
```

Consecuencias:

- `rounding: 1000` → múltiplo de 1000 más cercano; **exactamente 500 baja**
  (`1500 → 1000`).
- `rounding: -1000` → siguiente múltiplo de 1000 hacia arriba (`10500 → 11000`).
- Un `%` nunca redondea el precio final: solo genera enteros en cada paso.

---

## 7. Orden exacto

```ts
function precioDeRegla(texto, refs, rule): number | null {
  if (!rule.enabled) return null;

  const { dims, grosor } = parseQuery(texto);
  if (dims.length === 0) return null;

  const [dimSmall, dimLarge] = dims[0];          // ya en cm y ordenada

  const base = buscarReferencia(refs, rule, dimSmall, dimLarge);
  if (!base) return null;                        // sin categoría/variante/medida

  let P = base.precio;

  switch (rule.operation) {
    case 'percentage': P += Math.round(P * rule.operationValue / 100); break;
    case 'fixed':      P += rule.operationValue; break;
    case 'override':   P  = rule.operationValue; break;
    case 'direct':     break;
  }

  for (const c of rule.conditions) {
    const actual =
      c.field === 'grosor'     ? grosor :
      c.field === 'lado_mayor' ? Math.max(dimSmall, dimLarge) :
                                 Math.min(dimSmall, dimLarge);

    if (actual == null) continue;

    const cumple =
      c.operator === '>'  ? actual >  c.value :
      c.operator === '>=' ? actual >= c.value :
      c.operator === '<'  ? actual <  c.value :
      c.operator === '<=' ? actual <= c.value :
                            actual === c.value;

    if (!cumple) continue;

    if (c.adjustmentType === 'percentage')
      P += Math.round(P * c.adjustmentValue / 100);
    else
      P += c.adjustmentValue;
  }

  if (rule.rounding !== 0 && P > 0) P = roundPrice(P, rule.rounding);

  return P;
}
```

---

## 8. Ejemplos verificados

Precios base reales de `BASTIDOR`:

| Variante | 30x40 | 40x50 | 70x70 |
|---|---:|---:|---:|
| Sin Tela | 14.000 | 17.000 | 25.000 |
| Lienzo Profesional | 18.000 | 21.000 | 39.000 |

### Ejemplo A — `"pintura 40 x 50 x 5"`

Regla **Pinturas**: `percentage 10`, condición `grosor >= 2 → +10%`,
`rounding 1000`, base `BASTIDOR / Sin Tela`.

```text
base 40x50 Sin Tela          = 17.000
+10%                         = 17.000 + round(1.700)  = 18.700
grosor 5 >= 2 → +10%         = 18.700 + round(1.870)  = 20.570
redondeo 1000 (570 > 500)    = 21.000
```

**21.000**

### Ejemplo B — `"cambio de tela 40 x 50"`

Regla **Cambio de Tela**: `percentage -50`, sin condiciones,
`rounding -1000`, base `BASTIDOR / Lienzo Profesional`.

```text
base 40x50 Lienzo            = 21.000
-50%                         = 21.000 + round(-10.500) = 10.500
redondeo -1000 (hacia arriba)= 11.000
```

**11.000**

### Ejemplo C — `"tapacanto 40x50"`

Regla **Tapacanto**: `direct`, `rounding 1000`, base
`BASTIDOR / Lienzo Profesional`.

```text
base 40x50 Lienzo            = 21.000
direct                       = 21.000
redondeo 1000 (resto 0)      = 21.000
```

**21.000**

### Ejemplo D — medida sin fila exacta, `"pintura 67 x 67 x 3"`

`roundDim(67) = 70` ⇒ busca `70x70`. Como existe, toma 25.000 y no aplica
perímetro:

```text
base 70x70 Sin Tela          = 25.000
+10%                         = 27.500
grosor 3 >= 2 → +10%         = 30.250
redondeo 1000 (250 <= 500)   = 30.000
```

**30.000**

Si `70x70` no existiera, elegiría la fila con perímetro más cercano a
`2*(67+67) = 268` y usaría su precio sin escalar.

### Ejemplo E — redondeo "medio hacia abajo"

```text
P = 1.500, rounding = 1000
rem = 500, half = 500 → rem no es > half → floor
resultado = 1.000
```

---

## 9. Casos borde y trampas

1. **Sin medidas → sin precio.** `"pintura"` no dispara nada; el motor exige `AxB`.
2. **Los `%` se redondean en cada paso**, no al final. Cambia el resultado por
   pocos pesos.
3. **El redondeo es único y final.** No redondear entre operación y condiciones.
4. **`rounding` negativo = hacia arriba**; positivo = al más cercano con empate
   hacia abajo. No es "half-up".
5. **`override` ignora el precio base** (y puede quedar fuera de mercado; úsalo
   con cuidado).
6. **`direct` ignora `operation_value`**; no hace falta ponerlo en 0.
7. **Condición con campo ausente = no se cumple.** Si no hay grosor en el texto,
   `grosor >= 2` no suma.
8. **Condiciones acumulativas:** el segundo `%` se calcula sobre el precio que ya
   incluyó el primero.
9. **Variante vacía ≠ todas las variantes** en reglas de precio (sí lo es en
   estimaciones).
10. **Las reglas no se pisan entre sí:** múltiples matches = múltiples precios.
11. **Los GET devuelven strings JSON** en `match_tokens` y `conditions`; hay que
    parsearlos. `params` de estimación también es string.
12. **Tokens de 1–2 letras** producen falsos positivos por prefijo.

---

## 10. Contrato de API y CSV

Base: `https://api-bastidores.onrender.com` — **sin autenticación**.

| Método | Ruta | Uso |
|---|---|---|
| GET | `/pricing-rules` | Lista de reglas (snake_case, JSON en strings) |
| POST | `/pricing-rules` | Crear regla |
| PUT | `/pricing-rules/{id}` | Actualizar regla |
| DELETE | `/pricing-rules/{id}` | Borrar regla |
| GET | `/precios-referencia` | Lista de precios base |
| POST | `/precios-referencia/import` | Importar `{ "rows": [...] }` |
| DELETE | `/precios-referencia/{id}` | Borrar una referencia |
| DELETE | `/precios-referencia` | Vaciar todas |
| GET | `/estimation-rules` | Reglas de estimación (no cubiertas acá) |

Payload de escritura (`PricingRulePayload`, snake_case):

```json
{
  "name": "Pinturas",
  "match_tokens": "[\"pintura\",\"embastado\"]",
  "base_categoria": "BASTIDOR",
  "base_variante": "Sin Tela",
  "operation": "percentage",
  "operation_value": 10,
  "conditions": "[{\"field\":\"grosor\",\"operator\":\">=\",\"value\":2,\"adjustmentType\":\"percentage\",\"adjustmentValue\":10}]",
  "enabled": true,
  "rounding": 1000
}
```

### CSV de precios base

Formato (delimitador `;` o `,`, con header obligatorio):

```csv
CATEGORIA;MEDIDA;VARIANTE;PRECIO
BASTIDOR;30 x 40;Sin Tela;14000
BASTIDOR;30 x 40;Lienzo Profesional;18000
```

- `CATEGORIA` se guarda en mayúsculas.
- Se descartan filas con precio vacío, no numérico o ≤ 0.
- **El CSV no contiene las fórmulas**: solo el precio base. `operation`,
  `conditions` y `rounding` viven únicamente en `/pricing-rules`.

### Lectura desde otro programa

- **Opción A — API en vivo:** consumir solo los `GET`. Los endpoints de escritura
  están abiertos: no expongas el API completo ni compartas credenciales
  (no hay).
- **Opción B — snapshot:** exportar `GET /pricing-rules` y
  `GET /precios-referencia` a dos JSON y consumirlos offline. Más seguro y
  reproducible, pero queda desactualizado cuando cambian precios o reglas.

---

## Anexo — Snapshot de reglas al 2026-11-03

```json
[
  {
    "name": "Pinturas",
    "match_tokens": ["pintura", "embastado", "embastar"],
    "base_categoria": "BASTIDOR",
    "base_variante": "Sin Tela",
    "operation": "percentage",
    "operation_value": 10,
    "conditions": [{ "field": "grosor", "operator": ">=", "value": 2, "adjustmentType": "percentage", "adjustmentValue": 10 }],
    "rounding": 1000,
    "enabled": true
  },
  {
    "name": "Tapacanto",
    "match_tokens": ["tapacantos", "marco"],
    "base_categoria": "BASTIDOR",
    "base_variante": "Lienzo Profesional",
    "operation": "direct",
    "operation_value": 0,
    "conditions": [],
    "rounding": 1000,
    "enabled": true
  },
  {
    "name": "Caja fibro facil",
    "match_tokens": ["caja", "fibro facil", "fibro"],
    "base_categoria": "BASTIDOR",
    "base_variante": "Lienzo Profesional",
    "operation": "direct",
    "operation_value": 0,
    "conditions": [],
    "rounding": 1000,
    "enabled": true
  },
  {
    "name": "Sin Tela",
    "match_tokens": ["SinTela", "Sin"],
    "base_categoria": "BASTIDOR",
    "base_variante": "Sin Tela",
    "operation": "direct",
    "operation_value": 0,
    "conditions": [{ "field": "grosor", "operator": ">=", "value": 3, "adjustmentType": "percentage", "adjustmentValue": 10 }],
    "rounding": 1000,
    "enabled": true
  },
  {
    "name": "Cambio de Tela",
    "match_tokens": ["Cambio"],
    "base_categoria": "BASTIDOR",
    "base_variante": "Lienzo Profesional",
    "operation": "percentage",
    "operation_value": -50,
    "conditions": [],
    "rounding": -1000,
    "enabled": true
  },
  {
    "name": "Poner tela",
    "match_tokens": ["poner", "entelado", "entelar"],
    "base_categoria": "BASTIDOR",
    "base_variante": "Lienzo Profesional",
    "operation": "percentage",
    "operation_value": -50,
    "conditions": [],
    "rounding": -1000,
    "enabled": true
  },
  {
    "name": "Tapiz",
    "match_tokens": ["tapiz", "tapizado", "ta"],
    "base_categoria": "BASTIDOR",
    "base_variante": "Sin Tela",
    "operation": "percentage",
    "operation_value": 10,
    "conditions": [{ "field": "grosor", "operator": ">=", "value": 2, "adjustmentType": "percentage", "adjustmentValue": 10 }],
    "rounding": 1000,
    "enabled": true
  },
  {
    "name": "Impresion",
    "match_tokens": ["impre", "impresion", "imp"],
    "base_categoria": "BASTIDOR",
    "base_variante": "Sin Tela",
    "operation": "percentage",
    "operation_value": 10,
    "conditions": [{ "field": "grosor", "operator": ">=", "value": 2, "adjustmentType": "percentage", "adjustmentValue": 10 }],
    "rounding": 1000,
    "enabled": true
  }
]
```

---

## Checklist de implementación

- [ ] Parseo de `AxB` y `AxBxG`, con conversión m→cm y orden `menor x mayor`.
- [ ] `roundDim` (0–3 baja, 4–9 sube) antes de buscar la referencia.
- [ ] Match exacto por par redondeado; si no, perímetro más cercano.
- [ ] Operación `direct | percentage | fixed | override` con `round` a entero.
- [ ] Condiciones en orden, acumulativas, con `grosor` crudo y lados en cm.
- [ ] `roundPrice` con empate hacia abajo y negativos hacia arriba, una sola vez.
- [ ] Ignorar `enabled: false`; no inventar precio si falta categoría/variante.
- [ ] Reproducir los ejemplos A–E con exactitud.
