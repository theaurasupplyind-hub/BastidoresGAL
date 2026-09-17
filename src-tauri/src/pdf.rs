use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum InvoiceStyle {
    Original,
    OriginalTest,
    Moderno,
    Clasico,
}

impl InvoiceStyle {
    pub fn from_name(name: &str) -> Self {
        match name {
            "Original test" => Self::OriginalTest,
            "Moderno" => Self::Moderno,
            "Clasico" => Self::Clasico,
            _ => Self::Original,
        }
    }
}

#[derive(Debug, Clone)]
pub struct InvoiceItem {
    pub cantidad: f64,
    pub descripcion: String,
    pub precio_unitario: f64,
    pub total: f64,
}

#[derive(Debug, Clone)]
pub struct InvoiceData {
    #[allow(dead_code)]
    pub num_presupuesto: String,
    pub num_factura: String,
    pub fecha: String,
    pub cliente_nombre: String,
    pub cliente_domicilio: String,
    pub cliente_telefono: String,
    pub items: Vec<InvoiceItem>,
    pub total: f64,
    pub envio: f64,
    pub saldo: f64,
    pub is_presupuesto: bool,
    pub style: InvoiceStyle,
    #[allow(dead_code)]
    pub fecha_entrega: String,
}

fn embed_b64(data: &[u8]) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(data);
    format!("data:image/png;base64,{}", b64)
}

static BRAND_LOGO: &[u8] = include_bytes!("../../assets/brand-logo.png");
static IGN_ICON: &[u8] = include_bytes!("../../assets/ign.png");
static HEADER_BG: &[u8] = include_bytes!("../../assets/headercompleto.png");

fn asset_brand() -> String { embed_b64(BRAND_LOGO) }
fn asset_ign() -> String { embed_b64(IGN_ICON) }
fn asset_header() -> String { embed_b64(HEADER_BG) }

fn extract_between<'a>(s: &'a str, start: &str, end: &str) -> &'a str {
    if let Some(i) = s.find(start) {
        let rest = &s[i + start.len()..];
        if let Some(j) = rest.find(end) {
            return &rest[..j];
        }
    }
    ""
}

fn get_css(style: InvoiceStyle) -> String {
    let template = match style {
        InvoiceStyle::Original | InvoiceStyle::OriginalTest => include_str!("../../invoice_template.html"),
        InvoiceStyle::Moderno => include_str!("../../invoice_template_2.html"),
        InvoiceStyle::Clasico => include_str!("../../invoice_template_3.html"),
    };
    let css = extract_between(template, "<style>", "</style>");

    let page_css = match style {
        InvoiceStyle::Clasico => {
            r#"
.page-a4 { width:210mm; height:297mm; display:flex; flex-direction:column; overflow:hidden; margin:0 auto; background:white; }
.invoice-half { height:148.5mm; width:100%; display:flex; flex-direction:column; overflow:hidden; }
.cut-indicator { margin:0; border-top:2px dashed #999; position:relative; width:100%; height:2px; }
.cut-indicator::before { content:"✂ CORTE AQUÍ"; position:absolute; left:50%; top:-10px; transform:translateX(-50%); background:#fff; padding:0 10px; color:#666; font-size:11px; font-weight:bold; }
"#.to_string()
        }
        _ => {
            r#"
.cut-indicator { margin:0; border-top:2px dashed #999; position:relative; width:100%; height:2px; }
.cut-indicator::before { content:"✂ CORTE AQUÍ"; position:absolute; left:50%; top:-10px; transform:translateX(-50%); background:#fff; padding:0 10px; color:#666; font-size:11px; font-weight:bold; }
"#.to_string()
        }
    };

    let layout_css = r#"
.invoice-half.full-page { flex: none; height: auto; overflow: visible; }
.invoice-half-blank {}
.page-a4.page-full { justify-content: flex-start; }
"#;

    let totals_css = r#"
.totals-stack { display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
.subtotal-line { font-size:13px; color:#888; font-weight:600; white-space:nowrap; }
.grandtotal-line { font-size:22px; font-weight:900; color:#222; white-space:nowrap; }
.entrega-badge { background:transparent; border-radius:6px; padding:4px 12px; font-size:15px; font-weight:600; color:#333; text-align:center; margin:0 auto; white-space:nowrap; flex-shrink:0; max-width:45%; overflow:hidden; text-overflow:ellipsis; }
.entrega-badge span { font-size:22px; line-height:1.1; font-weight:800; color:#000; }
.entrega-badge.original-test-entrega span { font-size:22px; line-height:1.1; font-weight:800; color:#666; }
.footer, .footer-section, .footer-area { align-items:center !important; gap:8px; }
"#;

    format!("{}{}{}{}", css, page_css, layout_css, totals_css)
}

fn dia_semana_completo(fecha: &str) -> String {
    // Espera "D/M/YYYY" (con o sin ceros). Devuelve "Lunes 14".
    let p: Vec<&str> = fecha.split('/').collect();
    if p.len() != 3 {
        return fecha.to_string();
    }
    let d: i32 = p[0].trim().parse().unwrap_or(0);
    let m: i32 = p[1].trim().parse().unwrap_or(0);
    let y: i32 = p[2].trim().parse().unwrap_or(0);
    if d <= 0 || m <= 0 || y <= 0 {
        return fecha.to_string();
    }
    // Algoritmo de Zeller para no depender de chrono.
    let (mut mm, mut yy) = (m, y);
    if mm < 3 {
        mm += 12;
        yy -= 1;
    }
    let k = yy % 100;
    let j = yy / 100;
    let h = (d + (13 * (mm + 1)) / 5 + k + k / 4 + j / 4 + 5 * j) % 7;
    // h: 0=Sábado, 1=Domingo, 2=Lunes, ...
    let dias = ["Sábado", "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
    let dia = dias[h.rem_euclid(7) as usize];
    format!("{} {}", dia, d)
}

pub fn format_entrega_display(raw: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return String::new();
    }
    // Caso JSON {desde, hasta, extras} (lo que guarda Facturacion/Kanban).
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
        if v.get("desde").is_some() || v.get("hasta").is_some() {
            let desde = v.get("desde").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
            let hasta = v.get("hasta").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
            let extras: Vec<String> = v
                .get("extras")
                .and_then(|x| x.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|e| e.as_str().map(|s| s.trim().to_string()))
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            let mut s = String::new();
            if !desde.is_empty() && !hasta.is_empty() {
                if desde == hasta {
                    s = dia_semana_completo(&desde);
                } else {
                    s = format!("{} al {}", dia_semana_completo(&desde), dia_semana_completo(&hasta));
                }
            } else if !desde.is_empty() {
                s = dia_semana_completo(&desde);
            } else if !hasta.is_empty() {
                s = dia_semana_completo(&hasta);
            }
            if !extras.is_empty() {
                let extra_txt = format!(" +{}", extras.len());
                s.push_str(&extra_txt);
            }
            if s.is_empty() {
                return String::new();
            }
            return s;
        }
    }
    // Caso legacy: fecha simple "D/M/YYYY".
    if raw.contains('/') {
        return dia_semana_completo(raw);
    }
    raw.to_string()
}

fn is_retirar_item(item: &InvoiceItem) -> bool {
    let d = item.descripcion.trim().to_lowercase();
    d.split(|c: char| !c.is_alphanumeric()).any(|w| w == "retirar")
}

fn build_one_half(data: &InvoiceData, style: InvoiceStyle, items_subset: &[InvoiceItem], page_subtotal: f64) -> String {
    let title = if data.is_presupuesto { "PRESUPUESTO" } else { "FACTURA" };

    let parts: Vec<&str> = data.fecha.split('/').collect();
    let day = parts.first().copied().unwrap_or("");
    let month = parts.get(1).copied().unwrap_or("");
    let year = parts.get(2).copied().unwrap_or("");

    let b64_brand = asset_brand();
    let b64_ign = asset_ign();
    let b64_header = asset_header();

    let envio_text = if data.envio <= 0.0 {
        "Sin cargo".to_string()
    } else {
        format!("{:.0}", data.envio)
    };

    let grand_total = format!("{:.0}", data.total);
    let page_total = format!("{:.0}", page_subtotal);
    let is_pagado = data.saldo <= 0.01;
    let sin_pago = !is_pagado && data.saldo >= data.total - 0.01;

    let show_detailed = data.is_presupuesto && items_subset.len() < data.items.len();

    let saldo_display = if data.total <= 0.01 {
        String::new()
    } else if show_detailed {
        // Formato detallado para presupuestos multi-página
        if is_pagado {
            format!(
                r#"<div class="totals-stack"><span class="subtotal-line">Subtotal hoja: ${}</span><span class="grandtotal-line">Total gral: {}</span><span class="saldo-value pagado">✓ Pagado</span></div>"#,
                page_total, grand_total
            )
        } else if sin_pago {
            format!(
                r#"<div class="totals-stack"><span class="subtotal-line">Subtotal hoja: ${}</span><span class="grandtotal-line">Total gral: {}</span></div>"#,
                page_total, grand_total
            )
        } else {
            format!(
                r#"<div class="totals-stack"><span class="subtotal-line">Subtotal hoja: ${}</span><span class="grandtotal-line">Total gral: {}</span><span class="saldo-value debe">Saldo: {:.0}</span></div>"#,
                page_total, grand_total, data.saldo
            )
        }
    } else {
        // Formato original para facturas y presupuestos de 1 página
        if is_pagado {
            r#"<span class="saldo-value pagado">✓ Pagado</span>"#.to_string()
        } else if sin_pago {
            format!(r#"<span class="total-large">Total: {}</span>"#, grand_total)
        } else {
            format!(
                r#"<span class="total-small">Total: {}</span>        <span class="saldo-value debe">{:.0}</span>"#,
                grand_total, data.saldo
            )
        }
    };

    let items_rows = build_items_rows(items_subset);
    let entrega_text = format_entrega_display(&data.fecha_entrega);

    match style {
        InvoiceStyle::Original => build_original_half(
            title, &data.num_factura, day, month, year,
            &data.cliente_nombre, &data.cliente_telefono, &data.cliente_domicilio,
            &items_rows, &envio_text, &entrega_text, &saldo_display,
            &b64_brand, &b64_ign,
        ),
        InvoiceStyle::OriginalTest => {
            let html = build_original_half(
                title, &data.num_factura, day, month, year,
                &data.cliente_nombre, &data.cliente_telefono, &data.cliente_domicilio,
                &items_rows, &envio_text, &entrega_text, &saldo_display,
                &b64_brand, &b64_ign,
            );
            html.replace(
                "<div class=\"entrega-badge\">ENTREGA: <span>",
                "<div class=\"entrega-badge original-test-entrega\"><span>",
            )
        },
        InvoiceStyle::Moderno => build_moderno_half(
            title, &data.num_factura, day, month, year,
            &data.cliente_nombre, &data.cliente_telefono, &data.cliente_domicilio,
            &items_rows, &envio_text, &entrega_text, &saldo_display,
            &b64_ign, &b64_header,
        ),
        InvoiceStyle::Clasico => build_clasico_half(
            title, &data.num_factura, day, month, year,
            &data.cliente_nombre, &data.cliente_telefono, &data.cliente_domicilio,
            &items_rows, &envio_text, &entrega_text, &saldo_display,
        ),
    }
}

fn build_items_rows(items: &[InvoiceItem]) -> String {
    let mut rows = String::new();
    let row_count = items.len().max(7);
    for i in 0..row_count {
        let (qty, desc, price, total) = if i < items.len() {
            let it = &items[i];
            let hide = it.cantidad == 0.0 || is_retirar_item(it);
            let q = if hide { String::new() } else { format!("{}", it.cantidad as i64) };
            let p = if hide { String::new() } else { format!("${:.0}", it.precio_unitario) };
            let t = if hide { String::new() } else { format!("${:.0}", it.total) };
            (q, it.descripcion.clone(), p, t)
        } else {
            (String::new(), String::new(), String::new(), String::new())
        };
        rows.push_str(&format!(
            "<tr><td class=\"col-cant\">{}</td><td class=\"col-desc\">{}</td><td class=\"col-pu\">{}</td><td class=\"col-tot\">{}</td></tr>\n",
            qty, desc, price, total
        ));
    }
    rows
}

fn build_original_half(
    title: &str, num: &str, day: &str, month: &str, year: &str,
    cliente: &str, tel: &str, domicilio: &str,
    items_rows: &str, envio: &str, entrega: &str, saldo_display: &str,
    brand_b64: &str, ign_b64: &str,
) -> String {
    let ig_html = if ign_b64.is_empty() {
        "<div class=\"instagram\"><span>bastidoresgal</span></div>".to_string()
    } else {
        format!("<div class=\"instagram\"><img src=\"{}\" class=\"ig-icon\"><span>bastidoresgal</span></div>", ign_b64)
    };

    let logo_html = if brand_b64.is_empty() {
        String::new()
    } else {
        format!("<img src=\"{}\" class=\"brand-logo\">", brand_b64)
    };

    format!(r#"
<div class="invoice-container">
  <div class="header">
    <div class="company-info">
      <div class="info-lines">
        <span>Bermudez 331 - C.A.B.A</span>
        <span>11 3102 7212 Jorge Blanco</span>
        <span>11 3102 7216 Tobias Blanco</span>
      </div>
      {ig}
    </div>
    {logo}
    <div class="invoice-meta">
      <div class="meta-title">{title}</div>
      <div class="meta-number">N° <span>{num}</span></div>
      <div class="meta-date">FECHA: <span>{day}</span>/<span>{month}</span>/<span>{year}</span></div>
    </div>
  </div>
  <div class="client-box">
    <div class="client-row">
      <span class="c-label">Cliente:</span>
      <span class="c-val">{cliente}</span>
      <span class="c-label" style="width:50px;margin-left:15px;">Tel:</span>
      <span class="c-val" style="flex:0.7">{tel}</span>
    </div>
    <div class="client-row" style="margin-top:8px;">
      <span class="c-label">Domicilio:</span>
      <span class="c-val">{domicilio}</span>
    </div>
  </div>
  <table class="items-table">
    <thead><tr><th class="col-cant">Cant.</th><th class="col-desc">Descripcion</th><th class="col-pu">P. Unit</th><th class="col-tot">Subtotal</th></tr></thead>
    <tbody id="invoiceItems">{items}</tbody>
  </table>
  <div class="footer">
    <div class="shipping-badge">ENVIO: <span>{envio}</span></div>
    <div class="entrega-badge">ENTREGA: <span>{entrega}</span></div>
    <div class="total-block">
      <div class="saldo-row">
        {saldo_display}
      </div>
    </div>
  </div>
</div>
"#,
        ig = ig_html,
        logo = logo_html,
        title = title,
        num = num,
        day = day,
        month = month,
        year = year,
        cliente = cliente,
        tel = tel,
        domicilio = domicilio,
        items = items_rows,
        envio = envio,
        entrega = entrega,
        saldo_display = saldo_display,
    )
}

fn build_moderno_half(
    title: &str, num: &str, day: &str, month: &str, year: &str,
    cliente: &str, tel: &str, domicilio: &str,
    items_rows: &str, envio: &str, entrega: &str, saldo_display: &str,
    ign_b64: &str, header_b64: &str,
) -> String {
    let bg_img = if header_b64.is_empty() {
        String::new()
    } else {
        format!("<img src=\"{}\" class=\"header-bg-img\" alt=\"Fondo\">", header_b64)
    };

    let ig_html = if ign_b64.is_empty() {
        "<div class=\"instagram-row\"><span>bastidoresgal</span></div>".to_string()
    } else {
        format!("<div class=\"instagram-row\"><img src=\"{}\" class=\"instagram-icon\" alt=\"IG\">bastidoresgal</div>", ign_b64)
    };

    format!(r#"
<div class="header-container">
  {bg}
  <div class="header-overlay">
    <div class="header-top-row">
      <div class="header-left">
        <h1>{title}</h1>
        <div class="invoice-nro">N° <span>{num}</span></div>
        <div class="invoice-date">
          FECHA <span class="date-box">{day}</span>
          <span class="date-box">{month}</span>
          <span class="date-box">{year}</span>
        </div>
      </div>
      <div class="header-spacer"></div>
      <div class="header-right">
        <div>Bermudez 331 - C.A.B.A</div>
        <div>11 3102 7212 Jorge Blanco</div>
        <div>11 3102 7216 Tobias Blanco</div>
        {ig}
      </div>
    </div>
    <div class="header-client-row">
      <div class="client-top-line">
        <div>Senor(es): <span class="val">{cliente}</span></div>
        <div>Tel: <span class="val">{tel}</span></div>
      </div>
      <div>Domicilio: <span class="val">{domicilio}</span></div>
    </div>
  </div>
</div>
<div class="body-content">
  <table>
    <thead><tr><th>CANT.</th><th>DETALLE</th><th>PRECIO U.</th><th>TOTAL</th></tr></thead>
    <tbody id="invoiceItems">{items}</tbody>
  </table>
  <div class="footer-section">
    <div class="shipping-info">ENVIO: <span>{envio}</span></div>
    <div class="entrega-badge">ENTREGA: <span>{entrega}</span></div>
    <div class="total-amount">
      <div class="saldo-row">
        {saldo_display}
      </div>
    </div>
  </div>
</div>
"#,
        bg = bg_img,
        ig = ig_html,
        title = title,
        num = num,
        day = day,
        month = month,
        year = year,
        cliente = cliente,
        tel = tel,
        domicilio = domicilio,
        items = items_rows,
        envio = envio,
        entrega = entrega,
        saldo_display = saldo_display,
    )
}

fn build_clasico_half(
    title: &str, num: &str, day: &str, month: &str, year: &str,
    cliente: &str, tel: &str, domicilio: &str,
    items_rows: &str, envio: &str, entrega: &str, saldo_display: &str,
) -> String {
    format!(r#"
<div class="invoice-container-mini">
  <div class="header">
    <div>
      <div class="company-name">BASTIDORES GAL</div>
      <div class="company-details">
        Bermudez 331 - C.A.B.A<br>
        Tel: 3535-4271 / 11 3102 7212
      </div>
    </div>
    <div class="meta-box">
      <div class="meta-title">{title}</div>
      <div>N°: <span>{num}</span></div>
      <div>FECHA: <span>{day}</span>/<span>{month}</span>/<span>{year}</span></div>
    </div>
  </div>
  <div class="client-section">
    <div class="client-row">
      <span class="label">Senor(es):</span>
      <span class="value">{cliente}</span>
    </div>
    <div class="client-row">
      <span class="label">Domicilio:</span>
      <span class="value">{domicilio}</span>
    </div>
    <div class="client-row">
      <span class="label">Telefono:</span>
      <span class="value">{tel}</span>
    </div>
  </div>
  <table class="items-table">
    <thead><tr><th class="col-cant">Cant</th><th>Descripcion / Concepto</th><th class="col-pu">P. Unit</th><th class="col-tot">Total</th></tr></thead>
    <tbody id="invoiceItems">{items}</tbody>
  </table>
  <div class="footer-area">
    <div class="shipping-box">ENVIO: <span>{envio}</span></div>
    <div class="entrega-badge">ENTREGA: <span>{entrega}</span></div>
    <div class="total-box">
      <div class="saldo-row">
        {saldo_display}
      </div>
    </div>
  </div>
</div>
"#,
        title = title,
        num = num,
        day = day,
        month = month,
        year = year,
        cliente = cliente,
        tel = tel,
        domicilio = domicilio,
        items = items_rows,
        envio = envio,
        entrega = entrega,
        saldo_display = saldo_display,
    )
}

fn find_chrome() -> Option<PathBuf> {
    let candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Chromium\Application\chrome.exe",
        r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ];
    for p in candidates {
        let path = Path::new(p);
        if path.exists() { return Some(path.to_path_buf()); }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        for p in [r"Google\Chrome\Application\chrome.exe", r"Microsoft\Edge\Application\msedge.exe"] {
            let path = Path::new(&local).join(p);
            if path.exists() { return Some(path); }
        }
    }
    None
}

fn html_to_pdf(html_content: &str, output_pdf: &str) -> Result<(), String> {
    let chrome = find_chrome().ok_or_else(|| {
        "No se encontro Chrome/Chromium/Edge. Instale Chrome para generar PDF.".to_string()
    })?;

    // Save HTML for debugging alongside PDF
    let html_path = format!("{}.debug.html", output_pdf.trim_end_matches(".pdf"));
    let _ = fs::write(&html_path, html_content);

    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join(format!("bastidores_invoice_{}.html", std::process::id()));
    fs::write(&temp_path, html_content)
        .map_err(|e| format!("Error al escribir HTML temporal: {}", e))?;

    let input_url = format!("file:///{}", temp_path.to_string_lossy().replace('\\', "/"));

    let output = std::process::Command::new(&chrome)
        .args(&[
            "--headless",
            "--disable-gpu",
            &format!("--print-to-pdf={}", output_pdf),
            "--no-pdf-header-footer",
            "--disable-print-preview",
            &input_url,
        ])
        .output()
        .map_err(|e| format!("Error al ejecutar Chrome: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Chrome often prints to stderr even on success, check if file exists
        if !Path::new(output_pdf).exists() {
            return Err(format!("Chrome fallo: {}", stderr));
        }
    }
    if !Path::new(output_pdf).exists() {
        return Err("Chrome no genero el archivo PDF".to_string());
    }
    Ok(())
}

/// Arma una hoja A4 con dos mitades distintas (2 facturas por hoja).
/// `bottom` en `None` deja la mitad inferior en blanco (caso impar / factura única).
fn push_paired_page(pages_html: &mut String, is_first: &mut bool, top: &str, bottom: Option<&str>) {
    if *is_first {
        *is_first = false;
        pages_html.push_str(r#"<div class="page-a4">"#);
    } else {
        pages_html.push_str(r#"<div class="page-a4" style="page-break-before:always">"#);
    }
    pages_html.push_str(&format!(
        r#"
<div class="invoice-half">{top}</div>
<div class="cut-indicator"></div>
<div class="invoice-half invoice-half-blank">{bottom}</div>
</div>
"#,
        top = top,
        bottom = bottom.unwrap_or(""),
    ));
}

/// Hoja exclusiva de hoja completa para una única factura larga.
/// Las filas siguen y ocupan la hoja, sin duplicar copia.
fn push_full_page(pages_html: &mut String, is_first: &mut bool, half: &str) {
    if *is_first {
        *is_first = false;
        pages_html.push_str(r#"<div class="page-a4 page-full">"#);
    } else {
        pages_html.push_str(r#"<div class="page-a4 page-full" style="page-break-before:always">"#);
    }
    pages_html.push_str(&format!(
        r#"
<div class="invoice-half full-page">{half}</div>
</div>
"#,
        half = half,
    ));
}

pub fn render_invoice_html(data: &InvoiceData) -> String {
    let css = get_css(data.style);

    let mut pages_html = String::new();
    let mut is_first = true;

    if data.is_presupuesto {
        let max_rows = 7;
        let chunks: Vec<_> = data.items.chunks(max_rows).collect();
        let chunks = if chunks.is_empty() { vec![&[] as &[InvoiceItem]] } else { chunks };

        // Cada chunk es una mitad; se apilan de a 2 por hoja.
        let mut pending: Option<String> = None;
        for chunk in chunks {
            let page_subtotal: f64 = chunk.iter().map(|i| i.total).sum();
            let half = build_one_half(data, data.style, chunk, page_subtotal);
            if let Some(top) = pending.take() {
                push_paired_page(&mut pages_html, &mut is_first, &top, Some(&half));
            } else {
                pending = Some(half);
            }
        }
        if let Some(top) = pending.take() {
            push_paired_page(&mut pages_html, &mut is_first, &top, None);
        }
    } else if data.items.len() > 7 {
        let half = build_one_half(data, data.style, &data.items, data.total);
        push_full_page(&mut pages_html, &mut is_first, &half);
    } else {
        let half = build_one_half(data, data.style, &data.items, data.total);
        push_paired_page(&mut pages_html, &mut is_first, &half, None);
    }

    format!(
        r#"<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>{css}</style>
</head>
<body>
{pages}</body>
</html>"#,
        css = css,
        pages = pages_html,
    )
}

pub fn render_invoices_batch_html(invoices: &[InvoiceData]) -> String {
    if invoices.is_empty() {
        return String::new();
    }

    let style = invoices[0].style;
    let css = get_css(style);

    let mut pages_html = String::new();
    let mut is_first = true;
    // Mitad pendiente de emparejar: cada factura normal (o chunk de
    // presupuesto) ocupa una mitad; se emiten de a 2 por hoja.
    let mut pending: Option<String> = None;

    for data in invoices {
        if data.is_presupuesto {
            let max_rows = 7;
            let chunks: Vec<_> = data.items.chunks(max_rows).collect();
            let chunks = if chunks.is_empty() { vec![&[] as &[InvoiceItem]] } else { chunks };

            for chunk in chunks {
                let page_subtotal: f64 = chunk.iter().map(|i| i.total).sum();
                let half = build_one_half(data, style, chunk, page_subtotal);
                if let Some(top) = pending.take() {
                    push_paired_page(&mut pages_html, &mut is_first, &top, Some(&half));
                } else {
                    pending = Some(half);
                }
            }
        } else if data.items.len() > 7 {
            // Factura larga en lote: ocupa hoja completa exclusiva para no
            // desbordarse sobre la otra mitad. Primero se vacía el pendiente.
            if let Some(top) = pending.take() {
                push_paired_page(&mut pages_html, &mut is_first, &top, None);
            }
            let half = build_one_half(data, style, &data.items, data.total);
            push_full_page(&mut pages_html, &mut is_first, &half);
        } else {
            let half = build_one_half(data, style, &data.items, data.total);
            if let Some(top) = pending.take() {
                push_paired_page(&mut pages_html, &mut is_first, &top, Some(&half));
            } else {
                pending = Some(half);
            }
        }
    }

    // Si quedó una impar, la otra mitad del papel queda en blanco.
    if let Some(top) = pending.take() {
        push_paired_page(&mut pages_html, &mut is_first, &top, None);
    }

    format!(
        r#"<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>{css}</style>
</head>
<body>
{pages}</body>
</html>"#,
        css = css,
        pages = pages_html,
    )
}

pub fn generate_invoice(
    data: &InvoiceData,
    output_path: &str,
    _logo_path: Option<&str>,
    _ign_path: Option<&str>,
    _header_path: Option<&str>,
) -> Result<(), String> {
    let full_html = render_invoice_html(data);
    html_to_pdf(&full_html, output_path)
}

pub fn generate_invoices_batch(
    invoices: &[InvoiceData],
    output_path: &str,
) -> Result<(), String> {
    if invoices.is_empty() {
        return Err("No hay facturas para generar".to_string());
    }

    let full_html = render_invoices_batch_html(invoices);
    html_to_pdf(&full_html, output_path)
}

pub fn generate_molduras_pdf(html_content: &str, output_path: &str) -> Result<(), String> {
    let dir = std::path::Path::new(output_path)
        .parent()
        .unwrap_or(std::path::Path::new("."));
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Error al crear directorio: {}", e))?;
    html_to_pdf(html_content, output_path)
}
