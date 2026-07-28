// Analiza TODOS los platos de una carta de golpe (en vez de uno a uno), para no
// tener que pulsar un botón por cada plato. La clave de la API vive aquí, nunca
// en el navegador.
const ALERGENOS_UE = [
  "Gluten", "Crustáceos", "Huevos", "Pescado", "Cacahuetes", "Soja",
  "Lácteos", "Frutos de cáscara", "Apio", "Mostaza", "Sésamo",
  "Sulfitos", "Altramuces", "Moluscos",
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No hay platos que analizar" });
    }

    // Solo mandamos lo que hace falta (id, nombre, desc, y las opciones añadibles con SU id),
    // para poder emparejar la respuesta de la IA sin ambigüedad de nombres repetidos.
    const payload = items.map((it) => ({
      id: it.id,
      nombre: it.nombre,
      desc: it.desc || "",
      grupos: (it.grupos || []).map((g) => ({
        opciones: (g.opciones || []).map((o) => ({ id: o.id, nombre: o.nombre })),
      })),
    }));

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content:
              "Analiza estos platos de un restaurante (te los paso en JSON) y para CADA UNO sugiere sus alérgenos, usando EXACTAMENTE estos nombres (ninguno inventado): " +
              JSON.stringify(ALERGENOS_UE) +
              ". Para cada plato, separa: " +
              '"alergenosBase" = los que lleva el plato SIEMPRE, tal cual viene por defecto. ' +
              '"opcionesConAlergenos" = por cada opción añadible que tenga (te paso su id) que aporte algún alérgeno propio, indica ese id y sus alérgenos — NO los mezcles con los del plato base, porque el cliente puede no elegir esa opción. MUY IMPORTANTE: no repitas en una opción ningún alérgeno que ya hayas puesto en "alergenosBase" de ese mismo plato (ej. si el plato base ya es "Gluten" por ser de pan, no vuelvas a poner "Gluten" en cada tipo de pan de sus opciones — solo indica alérgenos NUEVOS que esa opción añada y que el plato base no tuviera ya). ' +
              "Sé conservador: solo marca un alérgeno si hay razonable certeza por los ingredientes típicos. " +
              'Si el nombre/descripción del plato BASE es demasiado genérico o ambiguo para saber sus alérgenos con confianza (ej. "Tosta de la casa", "Especial del chef"), deja "alergenosBase" vacío y pon "necesitaRevision": true para ese plato. En el resto de casos, "necesitaRevision" debe ser false. ' +
              "Responde ÚNICAMENTE con JSON válido, sin texto adicional ni backticks, con esta forma exacta (un objeto por cada plato, en el mismo orden, usando el mismo \"id\" que te he pasado): " +
              '{"resultados":[{"id":"abc123","alergenosBase":["Gluten"],"opcionesConAlergenos":[{"id":"xyz789","alergenos":["Lácteos"]}],"necesitaRevision":false}]}. ' +
              "Aquí están los platos:\n\n" +
              JSON.stringify(payload),
          },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "Error llamando a la IA" });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
