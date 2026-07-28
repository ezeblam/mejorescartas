// Este middleware corre ANTES de servir la web normal. Su única función es:
// si quien visita es un robot conocido (Google, WhatsApp, Facebook, Twitter...),
// que no ejecuta JavaScript, le servimos una página mínima con el título,
// descripción e imagen correctos de ESE restaurante en concreto. A cualquier
// persona normal (navegador de verdad) no le afecta en nada: sigue viendo la web normal.

export const config = {
  matcher: "/((?!api/|favicon|og-image|robots.txt|sitemap.xml|assets/).*)",
};

const ROBOTS =
  /facebookexternalhit|Facebot|Twitterbot|WhatsApp|Slackbot|LinkedInBot|TelegramBot|Discordbot|Googlebot|bingbot|Pinterest|redditbot/i;

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export default async function middleware(request) {
  const ua = request.headers.get("user-agent") || "";
  if (!ROBOTS.test(ua)) return; // navegador normal → seguimos con la web de siempre

  const url = new URL(request.url);
  const slug = url.pathname.replace(/^\/+|\/+$/g, "").trim().toLowerCase();
  if (!slug) return; // portada → usamos las etiquetas ya fijas del index.html

  try {
    const res = await fetch(`${url.origin}/api/restaurante-meta?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) return;
    const r = await res.json();
    if (!r || !r.nombre) return;

    const titulo = `${r.nombre} — Carta`;
    const descripcion = r.direccion
      ? `Consulta la carta de ${r.nombre} (${r.direccion}) online.`
      : `Consulta la carta de ${r.nombre} online.`;
    const imagen = r.logoImage || `${url.origin}/og-image.png`;

    const html = `<!doctype html><html lang="es"><head>
<meta charset="UTF-8">
<title>${escapeHtml(titulo)}</title>
<meta name="description" content="${escapeHtml(descripcion)}">
<meta property="og:title" content="${escapeHtml(titulo)}">
<meta property="og:description" content="${escapeHtml(descripcion)}">
<meta property="og:image" content="${escapeHtml(imagen)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
</head><body>${escapeHtml(titulo)}</body></html>`;

    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch {
    return; // si algo falla, dejamos pasar la web normal
  }
}
