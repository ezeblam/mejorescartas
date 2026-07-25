// Esta función corre en el servidor de Vercel, nunca en el navegador.
// La contraseña real vive solo en la variable de entorno ADMIN_PASSWORD
// (configurada en Vercel → Settings → Environment Variables), nunca en el código.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }
  try {
    const { password } = req.body;
    const correcta = password && process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD;
    return res.status(200).json({ ok: !!correcta });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
