import { createClient } from "@supabase/supabase-js";

function clienteServicio() {
  // Igual que en guardar-restaurante.js: la Service Role Key solo vive aquí, en el servidor.
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const { slug } = req.body;
    const slugNorm = (slug || "").trim().toLowerCase();
    if (!slugNorm) return res.status(400).json({ error: "Falta el slug" });

    const supabase = clienteServicio();
    const clave = `restaurante:${slugNorm}`;

    const { data, error } = await supabase.from("app_data").select("value").eq("key", clave).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "No encontrado" });

    const restaurante = data.value;
    restaurante.visitas = (restaurante.visitas || 0) + 1;

    const { error: errorUpsert } = await supabase.from("app_data").upsert({ key: clave, value: restaurante });
    if (errorUpsert) throw errorUpsert;

    return res.status(200).json({ ok: true, visitas: restaurante.visitas });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
