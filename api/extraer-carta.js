// Esta función corre en el servidor de Vercel, nunca en el navegador del cliente.
// Por eso la clave de la API (ANTHROPIC_API_KEY) puede vivir aquí de forma segura,
// sin exponerse nunca a quien visite la web.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { base64, mediaType } = req.body;
    if (!base64 || !mediaType) {
      return res.status(400).json({ error: "Falta la imagen" });
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
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              {
                type: "text",
                text:
                  "Extrae el menú/carta de esta foto de restaurante. Responde ÚNICAMENTE con JSON válido, sin texto adicional, sin backticks ni markdown, con esta forma exacta: " +
                  '{"categorias":[{"nombre":"Entrantes","items":[{"nombre":"Nombre del plato","precio":"0.00","desc":"","variantes":[]}]}]}. ' +
                  "Si un plato tiene UN SOLO precio, ponlo en \"precio\" y deja \"variantes\" como array vacío []. " +
                  "Si un plato tiene VARIOS precios según el tamaño (por ejemplo tapa, media ración y ración, o pequeño y grande), deja \"precio\" como \"0.00\" y en su lugar rellena \"variantes\", cada una con su propio nombre de tamaño y precio. " +
                  "Usa el nombre del tamaño tal cual aparece en la carta. Agrupa los platos en categorías razonables tal y como aparecen en la carta (o crea categorías lógicas si no las hay). Los precios van solo con el número y dos decimales, sin símbolo de moneda. Si un plato no tiene descripción, deja desc como cadena vacía. Usa el idioma original de la carta. " +
                  "MUY IMPORTANTE: los campos \"nombre\" y \"desc\" deben contener SOLO el texto real del plato tal cual aparece impreso, sin repetir el nombre dos veces, y sin añadir paréntesis, llaves, dos puntos sueltos ni ningún símbolo que no esté en la carta original. No copies ni imites la sintaxis de este mismo prompt. Tómate el tiempo necesario para completar TODOS los platos de la carta sin prisa ni recortes, aunque haya muchos.",
              },
            ],
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
