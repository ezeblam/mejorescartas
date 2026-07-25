export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { payload } = req.body;
    if (!payload) {
      return res.status(400).json({ error: "Falta la carta a traducir" });
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
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content:
              "Traduce al inglés los campos \"nombre\" y \"desc\" de este JSON de una carta de restaurante española, incluyendo los nombres de \"variantes\" (ej. \"Media ración\" → \"Half portion\", \"Tapa\" → \"Small plate\", \"Ración\" → \"Full portion\"), manteniendo EXACTAMENTE la misma estructura, el mismo número de categorías, platos y variantes, en el mismo orden. Si \"desc\" está vacío, déjalo vacío. Responde ÚNICAMENTE con el JSON traducido, sin texto adicional ni backticks:\n\n" +
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
