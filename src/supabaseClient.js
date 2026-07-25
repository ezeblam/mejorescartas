import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

// Info de diagnóstico que la pantalla de error de la app puede mostrar en pantalla,
// sin necesidad de abrir las herramientas de desarrollador del navegador.
export const supabaseDebugInfo = {
  urlPresente: !!supabaseUrl,
  urlValor: supabaseUrl || "(vacío)",
  urlFormatoValido: /^https:\/\/.+\.supabase\.co\/?$/.test(supabaseUrl),
  keyPresente: !!supabaseAnonKey,
  keyLongitud: supabaseAnonKey.length,
};

export const supabase = createClient(
  supabaseUrl || "https://placeholder-no-configurado.supabase.co",
  supabaseAnonKey || "placeholder-no-configurado"
);
