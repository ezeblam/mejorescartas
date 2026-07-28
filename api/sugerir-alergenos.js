// Igual que extraer-carta.js pero solo para un plato suelto (cuando se añade a mano,
// no por foto). La clave de la API vive aquí, nunca en el navegador.
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
    const { nombre, desc, grupos } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: "Falta el nombre del plato" });
    }

    // Si el plato tiene grupos de opciones (ej. "Ingredientes": Jamón, Mantequilla...),
    // se los pasamos también a la IA, porque pueden aportar alérgenos que el nombre
    // del plato por sí solo no menciona (ej. una tostada con opción de mantequilla).
    let infoGrupos = "";
    if (Array.isArray(grupos) && grupos.length > 0) {
      const resumen = grupos
        .map((g) => `${g.titulo}: ${(g.opciones || []).map((o) => o.nombre).join(", ")}`)
        .join(" | ");
      infoGrupos =
        ` Este plato además permite añadir estas opciones (pueden aportar alérgenos aunque sean opcionales): ${resumen}.`;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content:
              `Analiza este plato de restaurante: nombre "${nombre}", descripción "${desc || "(sin descripción)"}".` +
              infoGrupos +
              " Usa EXACTAMENTE estos nombres de alérgeno (ninguno inventado): " +
              JSON.stringify(ALERGENOS_UE) +
              ". Separa los alérgenos en dos grupos: " +
              '"alergenosBase" = los que lleva el plato SIEMPRE, tal cual viene por defecto, sin añadir nada opcional. ' +
              '"opcionesConAlergenos" = por cada opción añadible (de las que te he pasado) que aporte algún alérgeno propio, indica su nombre exacto y sus alérgenos — NO los mezcles con los del plato base, porque el cliente puede no elegir esa opción. ' +
              "Sé conservador: solo marca un alérgeno si hay razonable certeza por los ingredientes típicos. " +
              'Si el nombre/descripción del plato BASE es demasiado genérico o ambiguo para saber sus alérgenos con confianza (ej. "Tosta de la casa", "Especial del chef"), deja "alergenosBase" vacío y pon "necesitaRevision": true. En el resto de casos, "necesitaRevision" debe ser false (aunque alguna opción añadible sí tenga alérgenos claros). ' +
              'Responde ÚNICAMENTE con JSON, sin texto adicional ni backticks, con esta forma exacta: ' +
              '{"alergenosBase":["Gluten"],"opcionesConAlergenos":[{"nombre":"Mantequilla","alergenos":["Lácteos"]}],"necesitaRevision":false}',
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
