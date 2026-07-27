// Genera el sitemap.xml al vuelo, consultando la base de datos, para que Google
// sepa que existen todas las cartas y las indexe (no solo la portada).
export default async function handler(req, res) {
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
    const origin = `https://${req.headers.host}`;

    let slugs = [];
    if (supabaseUrl && supabaseKey) {
      const r = await fetch(
        `${supabaseUrl}/rest/v1/app_data?key=like.restaurante:*&select=value`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      if (r.ok) {
        const filas = await r.json();
        slugs = filas
          .map((f) => f.value)
          .filter((v) => v && v.slug && v.pago !== "pendiente")
          .map((v) => v.slug);
      }
    }

    const urls = [
      `<url><loc>${origin}/</loc><changefreq>monthly</changefreq></url>`,
      ...slugs.map(
        (slug) => `<url><loc>${origin}/${slug}</loc><changefreq>daily</changefreq></url>`
      ),
    ].join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

    res.setHeader("Content-Type", "application/xml");
    res.status(200).send(xml);
  } catch (e) {
    res.status(500).send("");
  }
}
