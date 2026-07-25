// Devuelve {nombre, logoImage, direccion} de un restaurante por su slug.
// La usa el middleware (middleware.js) para generar vistas previas correctas
// al compartir un enlace (WhatsApp, Facebook, etc.) o cuando pasa un buscador.
export default async function handler(req, res) {
  try {
    const slug = (req.query.slug || "").toString().trim().toLowerCase();
    if (!slug) return res.status(400).json({ error: "Falta el slug" });

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: "Config incompleta" });

    const r = await fetch(
      `${supabaseUrl}/rest/v1/app_data?key=eq.restaurante:${encodeURIComponent(slug)}&select=value`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (!r.ok) return res.status(502).json({ error: "Error consultando la base de datos" });
    const filas = await r.json();
    const restaurante = filas?.[0]?.value;
    if (!restaurante) return res.status(404).json({ error: "No encontrado" });

    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).json({
      nombre: restaurante.nombre,
      logoImage: restaurante.logoImage || null,
      direccion: restaurante.direccion || "",
      pago: restaurante.pago,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
