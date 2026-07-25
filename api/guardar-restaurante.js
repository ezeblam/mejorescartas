import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

function clienteServicio() {
  // La Service Role Key vive solo aquí, en el servidor — nunca llega al navegador.
  // Se salta las reglas de seguridad de la base de datos por diseño de Supabase,
  // así que solo debe usarse después de comprobar el permiso nosotros mismos (abajo).
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function hashPassword(texto) {
  return crypto.createHash("sha256").update(texto).digest("hex");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const { restaurante, credencial, slugAnterior } = req.body;
    if (!restaurante || !restaurante.slug || !restaurante.id || !credencial) {
      return res.status(400).json({ error: "Faltan datos en la petición" });
    }

    const supabase = clienteServicio();

    if (credencial.tipo === "admin") {
      if (!process.env.ADMIN_PASSWORD || credencial.password !== process.env.ADMIN_PASSWORD) {
        return res.status(403).json({ error: "Contraseña de administrador incorrecta" });
      }
    } else if (credencial.tipo === "cliente") {
      const claveBuscar = `restaurante:${slugAnterior || restaurante.slug}`;
      const { data } = await supabase.from("app_data").select("value").eq("key", claveBuscar).maybeSingle();
      const actual = data?.value;
      if (!actual) {
        return res.status(404).json({ error: "Restaurante no encontrado" });
      }
      if (actual.id !== restaurante.id) {
        return res.status(403).json({ error: "No autorizado para modificar este restaurante" });
      }
      const hashEntrada = hashPassword(credencial.password || "");
      if (hashEntrada !== actual.passwordHash) {
        return res.status(403).json({ error: "Contraseña incorrecta" });
      }
    } else {
      return res.status(400).json({ error: "Tipo de credencial no reconocido" });
    }

    // Si el usuario (slug) ha cambiado, borramos la fila antigua para no dejar basura
    if (slugAnterior && slugAnterior !== restaurante.slug) {
      await supabase.from("app_data").delete().eq("key", `restaurante:${slugAnterior}`);
    }

    const { error } = await supabase
      .from("app_data")
      .upsert({ key: `restaurante:${restaurante.slug}`, value: restaurante });
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
