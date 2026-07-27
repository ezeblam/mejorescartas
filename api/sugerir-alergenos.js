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
    const { nombre, desc } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: "Falta el nombre del plato" });
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
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content:
              `Analiza este plato de restaurante: nombre "${nombre}", descripción "${desc || "(sin descripción)"}". ` +
              "Di qué alérgenos probablemente contiene, usando EXACTAMENTE estos nombres (ninguno inventado): " +
              JSON.stringify(ALERGENOS_UE) +
              ". Sé conservador: solo marca uno si hay razonable certeza por los ingredientes típicos de esa receta. " +
              'Si el nombre/descripción es demasiado genérico o ambiguo para saberlo con confianza (ej. "Tosta de la casa", "Especial del chef"), deja "alergenos" vacío y pon "necesitaRevision": true. En el resto de casos, "necesitaRevision" debe ser false. ' +
              'Responde ÚNICAMENTE con JSON, sin texto adicional ni backticks, con esta forma exacta: {"alergenos":["Gluten"],"necesitaRevision":false}',
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
