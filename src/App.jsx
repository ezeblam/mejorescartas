import React, { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Trash2, QrCode, LogOut, Store, Utensils, UtensilsCrossed, Check, X, ArrowLeft, Copy, Eye, EyeOff, ChefHat, Camera, Loader2, ImagePlus, RefreshCw, Printer, Languages, Filter, Lock } from "lucide-react";
import { supabase, supabaseDebugInfo } from "./supabaseClient";

// ---------- Utilidades ----------
const ALERGENOS = [
  "Gluten", "Crustáceos", "Huevos", "Pescado", "Cacahuetes", "Soja",
  "Lácteos", "Frutos de cáscara", "Apio", "Mostaza", "Sésamo",
  "Sulfitos", "Altramuces", "Moluscos",
];

// Traducción 1:1 (mismo orden) para mostrar en la carta pública cuando el idioma es EN
const ALERGENOS_EN = [
  "Gluten", "Crustaceans", "Eggs", "Fish", "Peanuts", "Soy",
  "Dairy", "Tree nuts", "Celery", "Mustard", "Sesame",
  "Sulphites", "Lupin", "Molluscs",
];
const traducirAlergeno = (a, idioma) => {
  if (idioma !== "en") return a;
  const i = ALERGENOS.indexOf(a);
  return i >= 0 ? ALERGENOS_EN[i] : a;
};

const uid = () => Math.random().toString(36).slice(2, 10);

// Pone en mayúscula la primera letra de un texto (respeta el resto tal cual lo escribió el cliente).
// Se aplica al salir del campo (onBlur), no mientras se escribe, para no interrumpir al usuario.
const capitalizarFrase = (texto) => {
  const t = (texto || "").trimStart();
  if (!t) return texto;
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// Corrige automáticamente comas por puntos en los precios (por si alguien escribe "10,50")
const corregirPrecio = (texto) => (texto || "").replace(",", ".").trim();

// La contraseña de superadmin ya NO vive aquí en el código (antes cualquiera podía
// leerla abriendo el código fuente de la web). Ahora se verifica en el servidor,
// mediante la variable de entorno ADMIN_PASSWORD configurada en Vercel.

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

// Hash SHA-256 de una contraseña (no reversible). Solo se guarda el hash, nunca el texto plano.
async function hashPassword(texto) {
  const enc = new TextEncoder().encode(texto);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Genera una contraseña legible tipo "tapas-4821"
function generarPasswordLegible() {
  const palabras = ["tapas", "jamon", "paella", "tortilla", "sangria", "croqueta", "gazpacho", "boqueron"];
  const palabra = palabras[Math.floor(Math.random() * palabras.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${palabra}-${num}`;
}

// Redimensiona una imagen y la devuelve como base64 (sin prefijo data:) + mediaType
function fileToBase64Resized(file, maxDim = 900, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg", dataUrl });
      };
      img.onerror = () => reject(new Error("Imagen no válida"));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Envía la foto de la carta a Claude y devuelve {categorias:[{nombre, items:[{nombre,precio,desc}]}]}
// Limpia restos de formato que a veces se cuelan en las respuestas de la IA
// (por ejemplo "Nombre) : (Nombre" duplicado, o llaves/paréntesis sueltos al final).
function limpiarTextoIA(s) {
  if (!s) return s;
  let t = String(s).trim();
  const separadoresDuplicado = [") : (", "):(", ") :(", "): ("];
  const tieneLetras = (x) => /[a-zA-ZÀ-ÿ]/.test(x);
  for (const sep of separadoresDuplicado) {
    const idx = t.indexOf(sep);
    if (idx !== -1) {
      const antes = t.slice(0, idx).trim();
      const despues = t.slice(idx + sep.length).trim();
      // Nos quedamos con el lado que tenga texto real; si ambos lo tienen, el más largo
      // (normalmente es el nombre completo repetido, no el fragmento cortado a medias)
      if (tieneLetras(antes) && tieneLetras(despues)) {
        t = antes.length >= despues.length ? antes : despues;
      } else if (tieneLetras(antes)) {
        t = antes;
      } else if (tieneLetras(despues)) {
        t = despues;
      } else {
        t = antes || despues || t;
      }
      break;
    }
  }
  // Quita paréntesis / llaves / corchetes / dos puntos sueltos, al principio o al final
  t = t.replace(/^[)\]}(){}\[:]+\s*/, "").trim();
  t = t.replace(/\s*[)\]}(){}\[:]+$/, "").trim();
  return t;
}

async function extraerCartaDeFoto(base64, mediaType) {
  const response = await fetch("/api/extraer-carta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64, mediaType }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("Respuesta vacía");
  const clean = textBlock.text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  if (!parsed.categorias) throw new Error("Formato inesperado");
  return parsed.categorias.map((cat) => ({
    id: uid(),
    nombre: limpiarTextoIA(cat.nombre) || "Categoría",
    items: (cat.items || []).map((it) => ({
      id: uid(),
      nombre: limpiarTextoIA(it.nombre) || "Plato",
      precio: it.precio || "0.00",
      desc: limpiarTextoIA(it.desc) || "",
      alergenos: [],
      disponible: true,
      foto: null,
      variantes: Array.isArray(it.variantes)
        ? it.variantes
            .filter((v) => v && v.nombre)
            .map((v) => ({ id: uid(), nombre: limpiarTextoIA(v.nombre), precio: v.precio || "0.00" }))
        : [],
      grupos: [],
    })),
  }));
}

const nuevaCarta = (nombre) => ({
  id: uid(),
  nombre,
  categorias: [],
});

const nuevoRestaurante = (nombre, slugBase) => ({
  id: uid(),
  slug: slugBase,
  nombre,
  logoEmoji: "🍽️",
  logoImage: null, // dataURL base64 si suben foto de logo
  direccion: "",
  telefono: "",
  passwordHash: null, // se rellena al crear con hashPassword()
  pago: "pendiente", // "al_dia" | "pendiente"
  cartas: [nuevaCarta("Carta principal")],
  cartaActivaId: null,
});

// Genera 5 restaurantes de ejemplo con cartas completas, para probar la navegación con datos reales variados.
// Todos comparten la contraseña "demo1234" (usuario = su slug).
async function generarDemoRestaurantes() {
  const hash = await hashPassword("demo1234");
  const it = (nombre, precio, desc, alergenos = [], disponible = true, variantes = [], grupos = []) => ({
    id: uid(),
    nombre,
    precio,
    desc,
    alergenos,
    disponible,
    foto: null,
    variantes: variantes.map((v) => ({ id: uid(), nombre: v.nombre, precio: v.precio })),
    grupos: grupos.map((g) => ({
      id: uid(),
      titulo: g.titulo,
      opciones: g.opciones.map((o) => ({ id: uid(), nombre: o.nombre, precio: o.precio || "" })),
    })),
  });
  const cat = (nombre, items) => ({ id: uid(), nombre, items });

  const base = (nombre, slug, logoEmoji, pago, cartasData) => {
    const cartas = cartasData.map(({ nombre: n, categorias }) => ({
      id: uid(),
      nombre: n,
      categorias,
    }));
    return {
      id: uid(),
      slug,
      nombre,
      logoEmoji,
      logoImage: null,
      direccion: "",
      telefono: "",
      passwordHash: hash,
      pago,
      cartas,
      cartaActivaId: cartas[0].id,
    };
  };

  return [
    base("Casa Manolo", "casamanolo", "🍢", "pendiente", [
      {
        nombre: "Carta de tapas",
        categorias: [
          cat("Tapas frías", [
            it("Jamón ibérico", "9.50", "Cortado a cuchillo, de bellota", ["Sulfitos"]),
            it("Salmorejo cordobés", "5.50", "Con huevo duro y jamón picado", ["Huevos", "Gluten"]),
            it("Ensaladilla rusa", "4.80", "Receta de la casa", ["Huevos"], false),
          ]),
          cat("Tapas calientes", [
            it("Croquetas de jamón (6ud)", "7.00", "Cremosas, hechas a diario", ["Gluten", "Lácteos", "Huevos"]),
            it("Boquerones fritos", "6.50", "", ["Pescado", "Gluten"]),
            it("Patatas bravas", "5.00", "Salsa brava casera picante", ["Huevos"]),
            it("Calamares fritos", "0", "Frescos, cortados a la andaluza", ["Moluscos", "Gluten"], true, [
              { nombre: "Tapa", precio: "6.00" },
              { nombre: "Media ración", precio: "10.50" },
              { nombre: "Ración", precio: "15.00" },
            ]),
          ]),
          cat("Bebidas", [
            it("Caña", "1.80", ""),
            it("Vino de la casa (copa)", "2.20", "", ["Sulfitos"]),
            it("Refresco", "2.00", ""),
          ]),
        ],
      },
    ]),

    base("El Rincón del Mar", "elrincondelmar", "🐟", "al_dia", [
      {
        nombre: "Mediodía",
        categorias: [
          cat("Entrantes", [
            it("Pulpo a la gallega", "14.00", "Con patata cocida y pimentón de la Vera", []),
            it("Gambas al ajillo", "12.50", "", ["Crustáceos"]),
          ]),
          cat("Pescados", [
            it("Lubina a la sal", "19.00", "Pieza entera para compartir", ["Pescado"]),
            it("Merluza a la plancha", "16.50", "", ["Pescado"]),
          ]),
          cat("Postres", [it("Tarta de queso", "5.50", "Casera, horneada a diario", ["Lácteos", "Huevos"])]),
        ],
      },
      {
        nombre: "Noche",
        categorias: [
          cat("Para picar", [
            it("Tabla de ibéricos", "16.00", "Jamón, lomo y chorizo", ["Sulfitos"]),
            it("Calamares a la romana", "11.00", "", ["Moluscos", "Gluten"]),
          ]),
          cat("Arroces (mín. 2 personas)", [
            it("Arroz negro", "17.50", "Con sepia y alioli", ["Moluscos", "Huevos"]),
          ]),
        ],
      },
    ]),

    base("Sushi Sakura", "sushisakura", "🍣", "al_dia", [
      {
        nombre: "Carta",
        categorias: [
          cat("Nigiri (2 piezas)", [
            it("Salmón", "4.50", "", ["Pescado"]),
            it("Atún rojo", "5.50", "", ["Pescado"]),
            it("Anguila", "6.00", "Con salsa unagi", ["Pescado", "Gluten", "Soja"]),
          ]),
          cat("Maki (8 piezas)", [
            it("California roll", "8.50", "Surimi, aguacate, pepino", ["Crustáceos", "Huevos"]),
            it("Salmón crujiente", "9.00", "Tempura, salsa picante", ["Pescado", "Gluten", "Huevos"], false),
          ]),
          cat("Bebidas", [it("Té verde", "2.00", ""), it("Cerveza japonesa", "3.50", "")]),
        ],
      },
    ]),

    base("La Trattoria di Marco", "latrattoriadimarco", "🍝", "al_dia", [
      {
        nombre: "Carta",
        categorias: [
          cat("Antipasti", [
            it("Burrata", "9.50", "Con tomate confitado y albahaca", ["Lácteos"]),
            it("Bruschetta", "6.00", "Tomate, ajo y albahaca fresca", ["Gluten"]),
          ]),
          cat("Pasta", [
            it("Carbonara", "12.00", "Receta tradicional romana", ["Gluten", "Huevos", "Lácteos"]),
            it("Pesto alla genovese", "11.50", "", ["Gluten", "Frutos de cáscara", "Lácteos"]),
          ]),
          cat("Pizza", [
            it("Margherita", "9.00", "Tomate, mozzarella, albahaca", ["Gluten", "Lácteos"]),
            it("Diavola", "11.00", "Picante, con nduja", ["Gluten", "Lácteos"]),
          ]),
          cat("Postres", [it("Tiramisú", "6.00", "Receta de la nonna", ["Gluten", "Huevos", "Lácteos"])]),
        ],
      },
    ]),

    base("Café Aurora", "cafeaurora", "☕", "al_dia", [
      {
        nombre: "Carta",
        categorias: [
          cat("Desayunos", [
            it(
              "Tostada con tomate y AOVE",
              "3.20",
              "Pan de payés",
              ["Gluten"],
              true,
              [],
              [
                {
                  titulo: "Tipo de pan",
                  opciones: [
                    { nombre: "Natural", precio: "" },
                    { nombre: "Integral", precio: "" },
                    { nombre: "Pan de horno", precio: "0.50" },
                  ],
                },
              ]
            ),
            it("Tostada con aguacate", "4.50", "Con huevo poché", ["Gluten", "Huevos"]),
          ]),
          cat("Bollería", [
            it("Croissant", "1.80", "Recién horneado", ["Gluten", "Lácteos"]),
            it("Napolitana de chocolate", "2.00", "", ["Gluten", "Lácteos"], false),
          ]),
          cat("Café y bebidas", [
            it("Café con leche", "1.60", ""),
            it("Zumo de naranja natural", "2.80", ""),
          ]),
        ],
      },
    ]),

    base("Asador El Encinar", "asadorelencinar", "🥩", "al_dia", [
      {
        nombre: "Carta completa",
        categorias: [
          cat("Para picar", [
            it("Pan con tomate y jamón", "6.50", "Pan de cristal tostado", ["Gluten", "Sulfitos"]),
            it("Croquetas de rabo de toro", "8.50", "6 unidades, caldo reducido 12h", ["Gluten", "Lácteos", "Huevos"]),
            it("Jamón ibérico de bellota", "16.00", "Cortado a mano, 100g", ["Sulfitos"]),
            it("Queso curado manchego", "9.00", "Con membrillo casero", ["Lácteos"]),
            it("Pimientos de Padrón", "6.00", "Fritos con sal gorda", []),
            it("Morcilla de Burgos a la plancha", "7.50", "Con piñones", []),
          ]),
          cat("Entrantes", [
            it("Ensalada de la casa", "7.00", "Tomate, cebolla, aceitunas, ventresca", ["Pescado"]),
            it("Crema de calabaza", "6.50", "Con crujiente de jamón", ["Lácteos"]),
            it("Pulpo a la brasa", "15.00", "Con puré de patata trufado", []),
            it("Alcachofas confitadas", "8.00", "Con jamón crujiente", [], false),
          ]),
          cat("Carnes a la brasa", [
            it("Chuletón de vaca madurada (500g)", "32.00", "Madurado 30 días, para compartir", []),
            it("Solomillo de ternera", "22.00", "Con salsa de foie", ["Lácteos"]),
            it("Entrecot de buey", "26.00", "", []),
            it("Costillas de cerdo ibérico", "17.50", "Marinadas 24h, glaseadas", []),
            it("Cordero lechal al horno (medio)", "28.00", "Encargar con antelación", []),
            it("Presa ibérica a la brasa", "18.00", "", []),
          ]),
          cat("Guarniciones", [
            it("Patatas panadera", "4.50", "", []),
            it("Pimientos asados", "4.00", "", []),
            it("Verduras de temporada a la brasa", "5.50", "", []),
          ]),
          cat("Postres", [
            it("Torrija caramelizada", "6.00", "Con helado de vainilla", ["Gluten", "Lácteos", "Huevos"]),
            it("Tarta de queso al horno", "6.00", "", ["Lácteos", "Huevos"]),
            it("Coulant de chocolate", "6.50", "Con helado", ["Gluten", "Lácteos", "Huevos", "Frutos de cáscara"]),
            it("Cuajada con miel y nueces", "5.00", "", ["Lácteos", "Frutos de cáscara"]),
          ]),
          cat("Vinos y bebidas", [
            it("Copa de vino Rioja Reserva", "4.50", "", ["Sulfitos"]),
            it("Copa de vino Ribera del Duero", "5.00", "", ["Sulfitos"]),
            it("Cerveza artesana", "3.20", "", ["Gluten"]),
            it("Agua con gas / sin gas", "2.00", ""),
            it("Café / infusión", "1.80", ""),
          ]),
        ],
      },
    ]),
  ];
}

// ---------- Almacenamiento (Supabase, base de datos real) ----------
// IMPORTANTE: cada restaurante se guarda en SU PROPIA fila (clave "restaurante:<slug>").
const claveDe = (slug) => `restaurante:${slug}`;

// A partir de aquí, TODOS los guardados/borrados pasan por funciones de servidor
// que comprueban una contraseña antes de aceptar el cambio (admin o la del propio
// restaurante). La clave pública de la web ya solo puede leer, nunca escribir
// directamente — así nadie puede tocar los datos sin permiso real.
async function guardarRestauranteViaServidor(restaurante, credencial, slugAnterior) {
  const res = await fetch("/api/guardar-restaurante", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restaurante, credencial, slugAnterior }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || "Error guardando el restaurante");
}

async function borrarRestauranteViaServidor(slug, credencial) {
  if (!credencial || credencial.tipo !== "admin") {
    throw new Error("Solo el superadmin puede borrar restaurantes");
  }
  const res = await fetch("/api/borrar-restaurante", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, adminPassword: credencial.password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || "Error borrando el restaurante");
}

async function loadRestaurantes() {
  const { data, error } = await supabase.from("app_data").select("key, value").like("key", "restaurante:%");
  if (error) throw error;
  return (data || []).map((row) => row.value);
}

// Trae solo UN restaurante por su slug (una sola fila), sin descargar los demás.
// Se usa cuando alguien entra directamente a una carta por QR/URL, para no traer
// de más los datos de todos tus restaurantes solo por ver el de uno.
async function loadUnRestaurante(slug) {
  const { data, error } = await supabase
    .from("app_data")
    .select("value")
    .eq("key", claveDe(slug))
    .maybeSingle();
  if (error) throw error;
  return data ? data.value : null;
}

// ---------- App raíz ----------
// Normaliza un slug: quita espacios y pasa a minúsculas, para que mayúsculas/minúsculas
// nunca sean un problema (ni al escribir a mano, ni por la autocapitalización de iPhone).
const normalizarSlug = (s) => (s || "").trim().toLowerCase();

// Lee el slug directamente de la URL del navegador (ej. mejorescartas.com/barmanolo → "barmanolo").
// Así el QR lleva de verdad a la carta del restaurante, no a la pantalla de inicio.
const getSlugDeURL = () => {
  if (typeof window === "undefined") return null;
  const path = normalizarSlug(window.location.pathname.replace(/^\/+|\/+$/g, ""));
  return path || null;
};

export default function App() {
  const slugInicialDeURL = getSlugDeURL();
  const [restaurantes, setRestaurantes] = useState(null);
  const restaurantesRef = useRef([]);
  useEffect(() => {
    restaurantesRef.current = restaurantes || [];
  }, [restaurantes]);
  const [vista, setVista] = useState(slugInicialDeURL ? "publica" : "inicio"); // inicio | admin-login | super | cliente-login | cliente-panel | publica | cartel
  const [clienteActivo, setClienteActivo] = useState(null); // id restaurante logueado
  const [slugPublico, setSlugPublico] = useState(slugInicialDeURL);
  const [slugCartel, setSlugCartel] = useState(null);
  const [sesionAdmin, setSesionAdmin] = useState(false);

  // Credencial en memoria (nunca en localStorage) usada para autorizar guardados.
  // { tipo: "admin", password } o { tipo: "cliente", password }.
  const credencialRef = useRef(null);

  // "Camino ligero": si alguien entra directo por QR/URL a una carta, no hace falta
  // descargar los datos de TODOS tus restaurantes — solo el suyo. En cuanto haya
  // cualquier otra navegación dentro de la app, pasamos al modo normal (carga completa).
  const [modoLigero, setModoLigero] = useState(!!slugInicialDeURL);
  const [restaurantePublicoDirecto, setRestaurantePublicoDirecto] = useState(undefined);
  const [errorCargaPublica, setErrorCargaPublica] = useState(null);

  useEffect(() => {
    if (slugInicialDeURL) {
      loadUnRestaurante(slugInicialDeURL)
        .then((r) => setRestaurantePublicoDirecto(r))
        .catch((e) => setErrorCargaPublica(e?.message || String(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navega a la carta pública de un restaurante y actualiza la URL real del navegador,
  // para que se pueda compartir, refrescar o volver atrás sin perder el sitio.
  const irACartaPublica = useCallback((slug) => {
    setModoLigero(false);
    const s = normalizarSlug(slug);
    setSlugPublico(s);
    setVista("publica");
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", "/" + s);
    }
  }, []);

  const irAInicio = useCallback(() => {
    setModoLigero(false);
    setVista("inicio");
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", "/");
    }
  }, []);

  // Si el usuario usa los botones de atrás/adelante del navegador, mantenemos la app sincronizada
  useEffect(() => {
    const onPopState = () => {
      setModoLigero(false);
      const s = getSlugDeURL();
      if (s) {
        setSlugPublico(s);
        setVista("publica");
      } else {
        setVista("inicio");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const [errorCarga, setErrorCarga] = useState(null);

  const recargarDatos = useCallback(() => {
    setErrorCarga(null);
    setRestaurantes(null);
    loadRestaurantes()
      .then((r) => setRestaurantes(r))
      .catch((e) => {
        console.error("Error cargando restaurantes:", e);
        setErrorCarga(e?.message || String(e));
        setRestaurantes([]);
      });
  }, []);

  // Solo cargamos la lista completa cuando NO estamos en el camino ligero
  // (es decir, para cualquier cosa que no sea "alguien entrando directo por QR").
  useEffect(() => {
    if (!modoLigero && restaurantes === null) {
      recargarDatos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoLigero]);

  // Restaura la sesión del restaurante si el navegador ya tenía una guardada
  // (evita que refrescar el móvil cierre la sesión del dueño). No se aplica si
  // se ha entrado directamente a la carta de un restaurante vía QR/URL.
  useEffect(() => {
    if (!restaurantes || restaurantes.length === 0) return;
    if (slugInicialDeURL) return;
    if (clienteActivo) return;
    try {
      const guardado = localStorage.getItem("clienteActivoId");
      if (guardado && restaurantes.some((r) => r.id === guardado)) {
        setClienteActivo(guardado);
        setVista("cliente-panel");
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantes]);

  const [guardadoOk, setGuardadoOk] = useState(false);
  const avisarGuardadoOk = () => {
    setGuardadoOk(true);
    setTimeout(() => setGuardadoOk(false), 2000);
  };

  // Guarda SOLO los restaurantes que han cambiado o se han borrado desde la última vez,
  // pasando siempre por las funciones de servidor (nunca escribiendo directo a la base
  // de datos), con la credencial que corresponda según quién ha iniciado sesión.
  const persist = useCallback(async (next) => {
    const prev = restaurantesRef.current;
    setRestaurantes(next);

    let credencial = credencialRef.current;
    if (!credencial) {
      const password = prompt(
        "Tu sesión para guardar cambios ha caducado. Vuelve a escribir tu contraseña para confirmar este cambio:"
      );
      if (!password) return;
      credencial =
        sesionAdmin && !clienteActivo
          ? { tipo: "admin", password }
          : { tipo: "cliente", password };
      credencialRef.current = credencial;
    }

    const idsNuevos = new Set(next.map((r) => r.id));
    const eliminados = prev.filter((p) => !idsNuevos.has(p.id));
    const operaciones = [];
    for (const r of next) {
      const anterior = prev.find((p) => p.id === r.id);
      const cambio = !anterior || JSON.stringify(anterior) !== JSON.stringify(r);
      if (cambio) {
        const slugAnterior = anterior && anterior.slug !== r.slug ? anterior.slug : undefined;
        operaciones.push(guardarRestauranteViaServidor(r, credencial, slugAnterior));
      }
    }
    for (const r of eliminados) {
      operaciones.push(borrarRestauranteViaServidor(r.slug, credencial));
    }
    try {
      await Promise.all(operaciones);
      if (operaciones.length > 0) avisarGuardadoOk();
    } catch (e) {
      console.error("Error guardando en Supabase:", e);
      // Si el fallo es por credencial incorrecta, la olvidamos para pedirla de nuevo la próxima vez
      if (/contraseñ|autorizad/i.test(e?.message || "")) credencialRef.current = null;
      alert(
        "⚠ El cambio no se ha podido guardar. Revisa tu conexión y vuelve a intentarlo.\n\nDetalle técnico: " +
          (e?.message || String(e))
      );
    }
  }, [sesionAdmin, clienteActivo]);

  // Camino ligero: solo para quien entra directo por QR/URL a una carta.
  if (modoLigero) {
    if (errorCargaPublica) {
      return (
        <div style={S.center}>
          <div style={S.card}>
            <div style={S.eyebrow}>No se ha podido cargar la carta</div>
            <p style={{ ...S.muted, wordBreak: "break-word" }}>{errorCargaPublica}</p>
          </div>
        </div>
      );
    }
    if (restaurantePublicoDirecto === undefined) {
      return (
        <div style={S.loadingScreen}>
          <ChefHat size={28} color="#C9A227" />
          <span style={{ marginTop: 10, fontFamily: F.body, color: "#B8B2A6" }}>Cargando…</span>
        </div>
      );
    }
    return (
      <CartaPublica
        restaurantes={restaurantePublicoDirecto ? [restaurantePublicoDirecto] : []}
        slugInicial={slugPublico}
        onVolver={irAInicio}
      />
    );
  }

  if (restaurantes === null) {
    return (
      <div style={S.loadingScreen}>
        <ChefHat size={28} color="#C9A227" />
        <span style={{ marginTop: 10, fontFamily: F.body, color: "#B8B2A6" }}>Cargando…</span>
      </div>
    );
  }

  if (errorCarga) {
    return (
      <div style={S.center}>
        <div style={S.card}>
          <div style={S.eyebrow}>No se ha podido conectar con la base de datos</div>
          <p style={{ ...S.muted, wordBreak: "break-word" }}>{errorCarga}</p>
          <div style={{ ...S.muted, wordBreak: "break-word", marginTop: 10, fontSize: 11, opacity: 0.8 }}>
            Diagnóstico — URL configurada: {supabaseDebugInfo.urlValor} (
            {supabaseDebugInfo.urlFormatoValido ? "formato correcto" : "⚠ formato raro"}) · Clave:{" "}
            {supabaseDebugInfo.keyPresente ? `presente, ${supabaseDebugInfo.keyLongitud} caracteres` : "⚠ vacía"}
          </div>
          <button style={{ ...S.btnPrimary, width: "100%", marginTop: 10 }} onClick={recargarDatos}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Inter:wght@400;500;600;700&display=swap');
      `}</style>

      {guardadoOk && <div style={S.toastGuardado}>✓ Guardado</div>}

      {vista === "inicio" && (
        <Inicio
          onSuper={() => setVista("admin-login")}
          onCliente={() => setVista("cliente-login")}
          onPublica={(slug) => irACartaPublica(slug)}
          restaurantes={restaurantes}
        />
      )}

      {vista === "admin-login" && (
        <AdminLogin
          onEntrar={(password) => {
            credencialRef.current = { tipo: "admin", password };
            setSesionAdmin(true);
            setVista("super");
          }}
          onVolver={irAInicio}
        />
      )}

      {vista === "super" && sesionAdmin && (
        <SuperAdmin
          restaurantes={restaurantes}
          setRestaurantes={persist}
          onVolver={() => {
            setSesionAdmin(false);
            credencialRef.current = null;
            irAInicio();
          }}
          onVerPublica={(slug) => irACartaPublica(slug)}
          onVerCartel={(slug) => {
            setSlugCartel(slug);
            setVista("cartel");
          }}
        />
      )}

      {vista === "cliente-login" && (
        <ClienteLogin
          restaurantes={restaurantes}
          onEntrar={(id, password) => {
            credencialRef.current = { tipo: "cliente", password };
            setClienteActivo(id);
            setVista("cliente-panel");
            try {
              localStorage.setItem("clienteActivoId", id);
            } catch {}
          }}
          onVolver={irAInicio}
        />
      )}

      {vista === "cliente-panel" && clienteActivo && (
        <ClientePanel
          restaurante={restaurantes.find((r) => r.id === clienteActivo)}
          restaurantes={restaurantes}
          setRestaurantes={persist}
          onSalir={() => {
            setClienteActivo(null);
            credencialRef.current = null;
            try {
              localStorage.removeItem("clienteActivoId");
            } catch {}
            irAInicio();
          }}
          onVerPublica={(slug) => irACartaPublica(slug)}
          onVerCartel={(slug) => {
            setSlugCartel(slug);
            setVista("cartel");
          }}
        />
      )}

      {vista === "publica" && (
        <CartaPublica restaurantes={restaurantes} slugInicial={slugPublico} onVolver={irAInicio} />
      )}

      {vista === "cartel" && (
        <CartelQR restaurantes={restaurantes} slug={slugCartel} onVolver={irAInicio} />
      )}
    </div>
  );
}

// ---------- Pantalla de inicio (simula "entrar por QR" o accesos) ----------
function Inicio({ onSuper, onCliente, onPublica, restaurantes }) {
  const [slug, setSlug] = useState("");
  return (
    <div style={S.center}>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={S.logoMark}>
          <UtensilsCrossed size={24} strokeWidth={2} />
        </div>
        <h1 style={S.wordmark}>MEJORES CARTAS</h1>
        <p style={S.sub}>La web madre para todas tus cartas de restaurante.</p>
      </div>

      <div style={S.card}>
        <div style={S.eyebrow}>Ver una carta (simula escanear el QR)</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={S.input}
            placeholder="slug-del-restaurante"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <button style={S.btnPrimary} onClick={() => slug && onPublica(slug.trim())}>
            Ver
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <button style={S.btnGhost} onClick={onCliente}>
          <Utensils size={16} /> Panel restaurante
        </button>
      </div>

      <button style={S.adminFooterLink} onClick={onSuper}>
        Acceso admin
      </button>
    </div>
  );
}

// ---------- Login superadmin (solo tú) ----------
function AdminLogin({ onEntrar, onVolver }) {
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [comprobando, setComprobando] = useState(false);

  const entrar = async () => {
    setComprobando(true);
    setError("");
    try {
      const res = await fetch("/api/verificar-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pass }),
      });
      const data = await res.json();
      if (data.ok) {
        onEntrar(pass);
      } else {
        setError("Contraseña incorrecta.");
      }
    } catch (e) {
      setError("No se pudo comprobar la contraseña. Revisa tu conexión.");
    } finally {
      setComprobando(false);
    }
  };

  return (
    <div style={S.center}>
      <TopBar title="Acceso admin" onBack={onVolver} minimal />
      <div style={S.card}>
        <div style={S.eyebrow}>Contraseña de superadmin</div>
        <input
          style={S.input}
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="••••••••"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && entrar()}
        />
        {error && <div style={S.errorText}>{error}</div>}
        <button style={{ ...S.btnPrimary, width: "100%", marginTop: 14 }} onClick={entrar} disabled={comprobando}>
          {comprobando ? "Comprobando…" : "Entrar"}
        </button>
      </div>
    </div>
  );
}

// ---------- Panel Superadmin ----------
function SuperAdmin({ restaurantes, setRestaurantes, onVolver, onVerPublica, onVerCartel }) {
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [passwordNueva, setPasswordNueva] = useState("");
  const [creando, setCreando] = useState(false);

  const altaRapida = async () => {
    if (!nombreNuevo.trim() || !passwordNueva.trim()) return;
    let base = slugify(nombreNuevo);
    let slug = base;
    let n = 2;
    while (restaurantes.some((r) => r.slug === slug)) {
      slug = `${base}${n}`;
      n++;
    }
    const r = nuevoRestaurante(nombreNuevo.trim(), slug);
    r.cartaActivaId = r.cartas[0].id;
    r.passwordHash = await hashPassword(passwordNueva.trim());
    await setRestaurantes([...restaurantes, r]);
    setNombreNuevo("");
    setPasswordNueva("");
    setCreando(false);
    alert(`Restaurante creado ✅\n\nUsuario: ${slug}\nContraseña: la que has puesto.`);
  };

  const restablecerPassword = async (id) => {
    const nueva = prompt("Escribe la nueva contraseña para este restaurante:");
    if (!nueva || !nueva.trim()) return;
    const hash = await hashPassword(nueva.trim());
    const next = restaurantes.map((r) => (r.id === id ? { ...r, passwordHash: hash } : r));
    await setRestaurantes(next);
    alert("Contraseña actualizada.");
  };

  const togglePago = async (id) => {
    const next = restaurantes.map((r) =>
      r.id === id ? { ...r, pago: r.pago === "al_dia" ? "pendiente" : "al_dia" } : r
    );
    await setRestaurantes(next);
  };

  const renombrarSlug = async (id, nuevoSlugRaw) => {
    const actual = restaurantes.find((r) => r.id === id);
    if (!actual) return;
    const nuevoSlug = slugify(nuevoSlugRaw);
    if (!nuevoSlug) {
      alert("El usuario no puede quedar vacío.");
      return;
    }
    if (nuevoSlug === actual.slug) return; // sin cambios reales
    if (restaurantes.some((r) => r.slug === nuevoSlug && r.id !== id)) {
      alert("Ya hay otro restaurante con ese usuario. Elige otro.");
      return;
    }
    if (
      !confirm(
        `Vas a cambiar el usuario de "${actual.slug}" a "${nuevoSlug}".\n\n` +
          "Esto también cambia la URL de la carta — cualquier QR ya impreso con la dirección antigua dejará de funcionar. Habría que reimprimirlo.\n\n¿Seguro?"
      )
    ) {
      return;
    }
    const next = restaurantes.map((r) => (r.id === id ? { ...r, slug: nuevoSlug } : r));
    await setRestaurantes(next);
  };

  const eliminar = async (id) => {
    if (!confirm("¿Eliminar este restaurante y su carta? No se puede deshacer.")) return;
    await setRestaurantes(restaurantes.filter((r) => r.id !== id));
  };

  const descargarCopiaSeguridad = () => {
    const contenido = JSON.stringify(restaurantes, null, 2);
    const blob = new Blob([contenido], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const fecha = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `copia-seguridad-mejorescartas-${fecha}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={S.page}>
      <TopBar title="Panel superadmin" onBack={onVolver} />

      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={S.eyebrow}>Copia de seguridad</div>
        <p style={{ ...S.muted, marginBottom: 10 }}>
          Descarga un archivo con todos tus restaurantes y sus cartas, por si algo fallara alguna vez.
        </p>
        <button style={S.btnGhost} onClick={descargarCopiaSeguridad}>
          Descargar copia de seguridad
        </button>
      </div>

      <div style={S.card}>
        <div style={S.eyebrow}>Alta rápida</div>
        {!creando ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={S.btnPrimary} onClick={() => setCreando(true)}>
              <Plus size={16} /> Nuevo restaurante
            </button>
            <button
              style={S.btnGhost}
              onClick={async () => {
                const demo = await generarDemoRestaurantes();
                await setRestaurantes([...restaurantes, ...demo]);
                alert("6 restaurantes de demo cargados (incluye una carta larga de 25+ platos). Usuario = su slug, contraseña para todos: demo1234");
              }}
            >
              Cargar de demo
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              style={S.input}
              placeholder="Nombre del restaurante"
              value={nombreNuevo}
              onChange={(e) => setNombreNuevo(e.target.value)}
              autoFocus
            />
            <input
              style={S.input}
              placeholder="Contraseña que te ha dado el cliente"
              value={passwordNueva}
              onChange={(e) => setPasswordNueva(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button style={S.btnPrimary} onClick={altaRapida}>
                Crear
              </button>
              <button style={S.btnGhost} onClick={() => setCreando(false)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={S.eyebrow}>
          Clientes ({restaurantes.length})
        </div>
        {restaurantes.length === 0 && (
          <p style={S.muted}>Aún no has dado de alta ningún restaurante.</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {restaurantes.map((r) => (
            <div key={r.id} style={S.rowCard}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <Logo restaurante={r} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.rowTitle}>{r.nombre}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                    <span style={S.rowSub}>Usuario del panel:</span>
                    <input
                      key={r.slug}
                      style={S.slugInlineInput}
                      defaultValue={r.slug}
                      onBlur={(e) => renombrarSlug(r.id, e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                <span
                  style={{
                    ...S.badge,
                    background: r.pago === "al_dia" ? "#2E5B3E" : "#7A2E2E",
                  }}
                  onClick={() => togglePago(r.id)}
                >
                  {r.pago === "al_dia" ? "Al día" : "Pendiente"}
                </span>
                <button style={S.iconBtn} onClick={() => restablecerPassword(r.id)} title="Restablecer contraseña">
                  <RefreshCw size={16} />
                </button>
                <button style={S.iconBtn} onClick={() => onVerCartel(r.slug)} title="Cartel QR">
                  <Printer size={16} />
                </button>
                <button style={S.iconBtn} onClick={() => onVerPublica(r.slug)} title="Ver carta">
                  <QrCode size={16} />
                </button>
                <button style={S.iconBtnDanger} onClick={() => eliminar(r.id)} title="Eliminar">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Login cliente ----------
function ClienteLogin({ restaurantes, onEntrar, onVolver }) {
  const [slug, setSlug] = useState(() => {
    try {
      return localStorage.getItem("clienteSlugRecordado") || "";
    } catch {
      return "";
    }
  });
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [comprobando, setComprobando] = useState(false);
  const [recordar, setRecordar] = useState(true);

  const entrar = async () => {
    const r = restaurantes.find((x) => x.slug === normalizarSlug(slug));
    if (!r) return setError("No existe ningún restaurante con ese usuario.");
    setComprobando(true);
    const hash = await hashPassword(pass);
    setComprobando(false);
    if (hash !== r.passwordHash) return setError("Contraseña incorrecta.");
    setError("");
    try {
      if (recordar) localStorage.setItem("clienteSlugRecordado", r.slug);
      else localStorage.removeItem("clienteSlugRecordado");
    } catch {}
    onEntrar(r.id, pass);
  };

  return (
    <div style={S.center}>
      <TopBar title="Acceso restaurante" onBack={onVolver} minimal />
      <div style={S.card}>
        <div style={S.eyebrow}>Usuario (tu slug)</div>
        <input style={S.input} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="mi-restaurante" />
        <div style={{ ...S.eyebrow, marginTop: 12 }}>Contraseña</div>
        <input
          style={S.input}
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="••••"
          onKeyDown={(e) => e.key === "Enter" && entrar()}
        />
        <label style={S.checkboxLabel}>
          <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
          Recordar mi usuario en este dispositivo
        </label>
        {error && <div style={S.errorText}>{error}</div>}
        <button style={{ ...S.btnPrimary, width: "100%", marginTop: 14 }} onClick={entrar} disabled={comprobando}>
          {comprobando ? "Comprobando…" : "Entrar"}
        </button>
      </div>
    </div>
  );
}

// ---------- Panel cliente ----------
function ClientePanel({ restaurante, restaurantes, setRestaurantes, onSalir, onVerPublica, onVerCartel }) {
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [extrayendoCarta, setExtrayendoCarta] = useState(false);
  const [errorExtraccion, setErrorExtraccion] = useState("");
  const logoInputRef = useRef(null);
  const cartaFotoInputRef = useRef(null);
  const fotoPlatoInputRef = useRef(null);
  const [objetivoFotoPlato, setObjetivoFotoPlato] = useState(null); // {catId, itemId}
  const [subiendoFotoPlato, setSubiendoFotoPlato] = useState(null); // itemId en curso

  if (!restaurante) return null;
  const update = async (fn) => {
    const next = restaurantes.map((r) => (r.id === restaurante.id ? fn({ ...r }) : r));
    await setRestaurantes(next);
  };

  const subirLogo = async (file) => {
    if (!file) return;
    setSubiendoLogo(true);
    try {
      const { dataUrl } = await fileToBase64Resized(file, 300, 0.85);
      await update((r) => {
        r.logoImage = dataUrl;
        return r;
      });
    } catch (e) {
      alert("No se pudo procesar la imagen del logo.");
    } finally {
      setSubiendoLogo(false);
    }
  };

  const subirFotoPlato = async (file) => {
    if (!file || !objetivoFotoPlato) return;
    const { catId, itemId } = objetivoFotoPlato;
    setSubiendoFotoPlato(itemId);
    try {
      const { dataUrl } = await fileToBase64Resized(file, 500, 0.8);
      updatePlato(catId, itemId, "foto", dataUrl);
    } catch (e) {
      alert("No se pudo procesar la foto del plato.");
    } finally {
      setSubiendoFotoPlato(null);
      setObjetivoFotoPlato(null);
    }
  };

  const cargarCartaDesdeFoto = async (file) => {
    if (!file) return;
    setExtrayendoCarta(true);
    setErrorExtraccion("");
    try {
      const { base64, mediaType } = await fileToBase64Resized(file, 1100, 0.85);
      const nuevasCategorias = await extraerCartaDeFoto(base64, mediaType);
      await update((r) => {
        const idObjetivo = r.cartaActivaId || r.cartas[0].id;
        r.cartas = r.cartas.map((c) =>
          c.id === idObjetivo ? { ...c, categorias: [...c.categorias, ...nuevasCategorias] } : c
        );
        return r;
      });
    } catch (e) {
      setErrorExtraccion("No se pudo leer la carta de la foto. Prueba con una foto más clara o añade los platos a mano.");
    } finally {
      setExtrayendoCarta(false);
    }
  };

  const cartaActiva =
    restaurante.cartas.find((c) => c.id === restaurante.cartaActivaId) || restaurante.cartas[0];

  const addCarta = () => {
    if (restaurante.cartas.length >= 2) return;
    update((r) => {
      r.cartas = [...r.cartas, nuevaCarta(`Carta ${r.cartas.length + 1}`)];
      return r;
    });
  };

  const renombrarCarta = (id, nombre) => {
    update((r) => {
      r.cartas = r.cartas.map((c) => (c.id === id ? { ...c, nombre } : c));
      return r;
    });
  };

  const activarCarta = (id) => {
    update((r) => {
      r.cartaActivaId = id;
      return r;
    });
  };

  const addCategoria = () => {
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? { ...c, categorias: [...c.categorias, { id: uid(), nombre: "Nueva categoría", items: [] }] }
          : c
      );
      return r;
    });
  };

  const renombrarCategoria = (catId, nombre) => {
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? { ...c, categorias: c.categorias.map((cat) => (cat.id === catId ? { ...cat, nombre } : cat)) }
          : c
      );
      return r;
    });
  };

  const eliminarCategoria = (catId) => {
    const categoria = cartaActiva.categorias.find((c) => c.id === catId);
    const numPlatos = categoria?.items.length || 0;
    if (numPlatos > 0 && !confirm(`Esta categoría tiene ${numPlatos} plato(s). ¿Seguro que quieres borrarla entera?`)) {
      return;
    }
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id ? { ...c, categorias: c.categorias.filter((cat) => cat.id !== catId) } : c
      );
      return r;
    });
  };

  // Clona un plato entero (con sus variantes y grupos de opciones) generando ids nuevos,
  // para usarlo como plantilla al duplicar platos parecidos.
  const clonarPlato = (it) => ({
    ...it,
    id: uid(),
    nombre: it.nombre + " (copia)",
    variantes: (it.variantes || []).map((v) => ({ ...v, id: uid() })),
    grupos: (it.grupos || []).map((g) => ({
      ...g,
      id: uid(),
      opciones: g.opciones.map((o) => ({ ...o, id: uid() })),
    })),
  });

  const duplicarPlato = (catId, itemId) => {
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? {
              ...c,
              categorias: c.categorias.map((cat) => {
                if (cat.id !== catId) return cat;
                const idx = cat.items.findIndex((i) => i.id === itemId);
                if (idx === -1) return cat;
                const items = [...cat.items];
                items.splice(idx + 1, 0, clonarPlato(cat.items[idx]));
                return { ...cat, items };
              }),
            }
          : c
      );
      return r;
    });
  };

  const duplicarCategoria = (catId) => {
    update((r) => {
      r.cartas = r.cartas.map((c) => {
        if (c.id !== cartaActiva.id) return c;
        const idx = c.categorias.findIndex((cat) => cat.id === catId);
        if (idx === -1) return c;
        const original = c.categorias[idx];
        const copia = {
          id: uid(),
          nombre: original.nombre + " (copia)",
          items: original.items.map((it) => clonarPlato(it)),
        };
        const categorias = [...c.categorias];
        categorias.splice(idx + 1, 0, copia);
        return { ...c, categorias };
      });
      return r;
    });
  };

  const addPlato = (catId) => {
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? {
              ...c,
              categorias: c.categorias.map((cat) =>
                cat.id === catId
                  ? {
                      ...cat,
                      items: [
                        ...cat.items,
                        {
                          id: uid(),
                          nombre: "Nuevo plato",
                          precio: "0.00",
                          desc: "",
                          alergenos: [],
                          disponible: true,
                          foto: null,
                          variantes: [],
                          grupos: [],
                        },
                      ],
                    }
                  : cat
              ),
            }
          : c
      );
      return r;
    });
  };

  const updatePlato = (catId, itemId, campo, valor) => {
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? {
              ...c,
              categorias: c.categorias.map((cat) =>
                cat.id === catId
                  ? {
                      ...cat,
                      items: cat.items.map((it) => (it.id === itemId ? { ...it, [campo]: valor } : it)),
                    }
                  : cat
              ),
            }
          : c
      );
      return r;
    });
  };

  const toggleAlergeno = (catId, itemId, alergeno) => {
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? {
              ...c,
              categorias: c.categorias.map((cat) =>
                cat.id === catId
                  ? {
                      ...cat,
                      items: cat.items.map((it) =>
                        it.id === itemId
                          ? {
                              ...it,
                              alergenos: it.alergenos.includes(alergeno)
                                ? it.alergenos.filter((a) => a !== alergeno)
                                : [...it.alergenos, alergeno],
                            }
                          : it
                      ),
                    }
                  : cat
              ),
            }
          : c
      );
      return r;
    });
  };

  const activarVariantes = (catId, itemId) => {
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? {
              ...c,
              categorias: c.categorias.map((cat) =>
                cat.id === catId
                  ? {
                      ...cat,
                      items: cat.items.map((i) =>
                        i.id === itemId
                          ? { ...i, variantes: [{ id: uid(), nombre: "Ración", precio: i.precio || "0.00" }] }
                          : i
                      ),
                    }
                  : cat
              ),
            }
          : c
      );
      return r;
    });
  };

  const desactivarVariantes = (catId, itemId) => {
    if (!confirm("Esto quita los precios por tamaño y vuelve a un precio único. ¿Seguro?")) return;
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? {
              ...c,
              categorias: c.categorias.map((cat) =>
                cat.id === catId
                  ? { ...cat, items: cat.items.map((i) => (i.id === itemId ? { ...i, variantes: [] } : i)) }
                  : cat
              ),
            }
          : c
      );
      return r;
    });
  };

  const addVariante = (catId, itemId) => {
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? {
              ...c,
              categorias: c.categorias.map((cat) =>
                cat.id === catId
                  ? {
                      ...cat,
                      items: cat.items.map((i) =>
                        i.id === itemId
                          ? { ...i, variantes: [...i.variantes, { id: uid(), nombre: "", precio: "0.00" }] }
                          : i
                      ),
                    }
                  : cat
              ),
            }
          : c
      );
      return r;
    });
  };

  const updateVariante = (catId, itemId, varId, campo, valor) => {
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? {
              ...c,
              categorias: c.categorias.map((cat) =>
                cat.id === catId
                  ? {
                      ...cat,
                      items: cat.items.map((i) =>
                        i.id === itemId
                          ? {
                              ...i,
                              variantes: i.variantes.map((v) => (v.id === varId ? { ...v, [campo]: valor } : v)),
                            }
                          : i
                      ),
                    }
                  : cat
              ),
            }
          : c
      );
      return r;
    });
  };

  // Reordena las variantes de un plato de menor a mayor precio (tapa antes que ración, etc.)
  // Corrige la coma por punto y reordena las variantes en una sola operación
  // (hacerlo en dos pasos separados podía usar el valor viejo al ordenar)
  const corregirYOrdenarVariante = (catId, itemId, varId, valorCrudo) => {
    const precio = corregirPrecio(valorCrudo);
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? {
              ...c,
              categorias: c.categorias.map((cat) =>
                cat.id === catId
                  ? {
                      ...cat,
                      items: cat.items.map((i) =>
                        i.id === itemId
                          ? {
                              ...i,
                              variantes: i.variantes
                                .map((v) => (v.id === varId ? { ...v, precio } : v))
                                .sort((a, b) => (parseFloat(a.precio) || 0) - (parseFloat(b.precio) || 0)),
                            }
                          : i
                      ),
                    }
                  : cat
              ),
            }
          : c
      );
      return r;
    });
  };

  const ordenarVariantesPorPrecio = (catId, itemId) => {
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? {
              ...c,
              categorias: c.categorias.map((cat) =>
                cat.id === catId
                  ? {
                      ...cat,
                      items: cat.items.map((i) =>
                        i.id === itemId
                          ? {
                              ...i,
                              variantes: [...i.variantes].sort(
                                (a, b) => (parseFloat(a.precio) || 0) - (parseFloat(b.precio) || 0)
                              ),
                            }
                          : i
                      ),
                    }
                  : cat
              ),
            }
          : c
      );
      return r;
    });
  };

  const removeVariante = (catId, itemId, varId) => {
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? {
              ...c,
              categorias: c.categorias.map((cat) =>
                cat.id === catId
                  ? {
                      ...cat,
                      items: cat.items.map((i) =>
                        i.id === itemId ? { ...i, variantes: i.variantes.filter((v) => v.id !== varId) } : i
                      ),
                    }
                  : cat
              ),
            }
          : c
      );
      return r;
    });
  };

  // Helper genérico: aplica una transformación a un plato concreto (evita repetir todo el anidado cada vez)
  const modificarItem = (catId, itemId, fn) => {
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? {
              ...c,
              categorias: c.categorias.map((cat) =>
                cat.id === catId
                  ? { ...cat, items: cat.items.map((i) => (i.id === itemId ? fn(i) : i)) }
                  : cat
              ),
            }
          : c
      );
      return r;
    });
  };

  // Grupos de opciones (ej. "Tipo de pan": Natural / Integral / Pan de horno +0,50€)
  const addGrupoOpciones = (catId, itemId) => {
    modificarItem(catId, itemId, (i) => ({
      ...i,
      grupos: [
        ...(i.grupos || []),
        { id: uid(), titulo: "Nuevas opciones", opciones: [{ id: uid(), nombre: "", precio: "" }] },
      ],
    }));
  };

  const removeGrupoOpciones = (catId, itemId, grupoId) => {
    if (!confirm("¿Borrar este grupo de opciones entero?")) return;
    modificarItem(catId, itemId, (i) => ({ ...i, grupos: (i.grupos || []).filter((g) => g.id !== grupoId) }));
  };

  const updateTituloGrupo = (catId, itemId, grupoId, titulo) => {
    modificarItem(catId, itemId, (i) => ({
      ...i,
      grupos: (i.grupos || []).map((g) => (g.id === grupoId ? { ...g, titulo } : g)),
    }));
  };

  const addOpcionAGrupo = (catId, itemId, grupoId) => {
    modificarItem(catId, itemId, (i) => ({
      ...i,
      grupos: (i.grupos || []).map((g) =>
        g.id === grupoId ? { ...g, opciones: [...g.opciones, { id: uid(), nombre: "", precio: "" }] } : g
      ),
    }));
  };

  const updateOpcion = (catId, itemId, grupoId, opcionId, campo, valor) => {
    modificarItem(catId, itemId, (i) => ({
      ...i,
      grupos: (i.grupos || []).map((g) =>
        g.id === grupoId
          ? { ...g, opciones: g.opciones.map((o) => (o.id === opcionId ? { ...o, [campo]: valor } : o)) }
          : g
      ),
    }));
  };

  const removeOpcion = (catId, itemId, grupoId, opcionId) => {
    modificarItem(catId, itemId, (i) => ({
      ...i,
      grupos: (i.grupos || []).map((g) =>
        g.id === grupoId ? { ...g, opciones: g.opciones.filter((o) => o.id !== opcionId) } : g
      ),
    }));
  };

  const eliminarPlato = (catId, itemId, nombrePlato) => {
    if (!confirm(`¿Seguro que quieres borrar "${nombrePlato}"? No se puede deshacer.`)) return;
    update((r) => {
      r.cartas = r.cartas.map((c) =>
        c.id === cartaActiva.id
          ? {
              ...c,
              categorias: c.categorias.map((cat) =>
                cat.id === catId ? { ...cat, items: cat.items.filter((it) => it.id !== itemId) } : cat
              ),
            }
          : c
      );
      return r;
    });
  };

  return (
    <div style={S.page}>
      <TopBar
        title={restaurante.nombre}
        onBack={onSalir}
        backIcon={<LogOut size={16} />}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.btnGhostSmall} onClick={() => onVerCartel(restaurante.slug)}>
              <Printer size={14} /> Cartel QR
            </button>
            <button style={S.btnGhostSmall} onClick={() => onVerPublica(restaurante.slug)}>
              <Eye size={14} /> Ver carta pública
            </button>
          </div>
        }
      />

      {/* Nombre visible + logo del restaurante */}
      <div style={{ ...S.card, marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
        <Logo restaurante={restaurante} size={52} radius={12} fontSize={24} />
        <div style={{ flex: 1 }}>
          <div style={S.eyebrow}>Nombre visible para el cliente</div>
          <input
            style={S.input}
            value={restaurante.nombre}
            onChange={(e) => update((r) => ({ ...r, nombre: e.target.value }))}
            onBlur={(e) => update((r) => ({ ...r, nombre: capitalizarFrase(e.target.value) }))}
            placeholder="Ej. Bar España"
          />
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <button
              style={S.btnGhostSmall}
              onClick={() => logoInputRef.current?.click()}
              disabled={subiendoLogo}
            >
              {subiendoLogo ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
              {subiendoLogo ? "Subiendo…" : restaurante.logoImage ? "Cambiar logo" : "Subir logo"}
            </button>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => subirLogo(e.target.files?.[0])}
            />
          </div>
        </div>
      </div>

      {/* Teléfono y dirección (se muestran en la carta pública) */}
      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={S.eyebrow}>Teléfono y dirección (visibles en la carta)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            style={{ ...S.input, flex: 1, minWidth: 140 }}
            value={restaurante.telefono}
            onChange={(e) => update((r) => ({ ...r, telefono: e.target.value }))}
            placeholder="Teléfono (opcional)"
          />
          <input
            style={{ ...S.input, flex: 2, minWidth: 200 }}
            value={restaurante.direccion}
            onChange={(e) => update((r) => ({ ...r, direccion: e.target.value }))}
            onBlur={(e) => update((r) => ({ ...r, direccion: capitalizarFrase(e.target.value) }))}
            placeholder="Dirección (opcional)"
          />
        </div>
      </div>

      {/* Selector de carta activa */}
      <div style={S.card}>
        <div style={S.eyebrow}>Cartas ({restaurante.cartas.length}/2) — cuál se ve hoy</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {restaurante.cartas.map((c) => (
            <div key={c.id} style={{ ...S.cartaTab, ...(c.id === cartaActiva.id ? S.cartaTabActiva : {}) }}>
              <input
                style={S.cartaTabInput}
                value={c.nombre}
                onChange={(e) => renombrarCarta(c.id, e.target.value)}
                onBlur={(e) => renombrarCarta(c.id, capitalizarFrase(e.target.value))}
              />
              {c.id === cartaActiva.id ? (
                <span style={S.badgeActiva}>
                  <Check size={12} /> Visible ahora
                </span>
              ) : (
                <button style={S.btnGhostSmall} onClick={() => activarCarta(c.id)}>
                  Mostrar esta
                </button>
              )}
            </div>
          ))}
          {restaurante.cartas.length < 2 && (
            <button style={S.btnGhost} onClick={addCarta}>
              <Plus size={14} /> Añadir 2ª carta
            </button>
          )}
        </div>
      </div>

      {/* Editor de la carta activa */}
      <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={S.eyebrow}>Editando: {cartaActiva.nombre}</div>
          <div>
            <button
              style={S.btnGhostSmall}
              onClick={() => cartaFotoInputRef.current?.click()}
              disabled={extrayendoCarta}
            >
              {extrayendoCarta ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
              {extrayendoCarta ? "Leyendo la carta…" : "Cargar carta desde foto"}
            </button>
            <input
              ref={cartaFotoInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                cargarCartaDesdeFoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        {errorExtraccion && <div style={{ ...S.errorText, marginBottom: 10 }}>{errorExtraccion}</div>}
        {extrayendoCarta && (
          <div style={{ ...S.muted, marginBottom: 10 }}>
            Analizando la foto y montando categorías y platos… puede tardar unos segundos.
          </div>
        )}
        <input
          ref={fotoPlatoInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            subirFotoPlato(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {cartaActiva.categorias.map((cat) => (
          <div key={cat.id} style={S.catCard}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <input
                style={S.catInput}
                value={cat.nombre}
                onChange={(e) => renombrarCategoria(cat.id, e.target.value)}
                onBlur={(e) => renombrarCategoria(cat.id, capitalizarFrase(e.target.value))}
              />
              <button style={S.iconBtn} onClick={() => duplicarCategoria(cat.id)} title="Duplicar categoría">
                <Copy size={14} />
              </button>
              <button style={S.iconBtnDanger} onClick={() => eliminarCategoria(cat.id)}>
                <Trash2 size={14} />
              </button>
            </div>

            {cat.items.map((it) => (
              <div key={it.id} style={S.itemCard}>
                <div style={{ display: "flex", gap: 10 }}>
                  {it.foto ? (
                    <img src={it.foto} alt={it.nombre} style={S.platoFotoThumb} />
                  ) : (
                    <button
                      style={S.platoFotoVacia}
                      onClick={() => {
                        setObjetivoFotoPlato({ catId: cat.id, itemId: it.id });
                        fotoPlatoInputRef.current?.click();
                      }}
                      disabled={subiendoFotoPlato === it.id}
                    >
                      {subiendoFotoPlato === it.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Camera size={16} />
                      )}
                    </button>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        style={{ ...S.input, flex: it.variantes.length > 0 ? 1 : 2 }}
                        value={it.nombre}
                        onChange={(e) => updatePlato(cat.id, it.id, "nombre", e.target.value)}
                        onBlur={(e) => updatePlato(cat.id, it.id, "nombre", capitalizarFrase(e.target.value))}
                        placeholder="Nombre del plato"
                      />
                      {it.variantes.length === 0 && (
                        <input
                          style={{ ...S.input, flex: 1 }}
                          value={it.precio}
                          onChange={(e) => updatePlato(cat.id, it.id, "precio", e.target.value)}
                          onBlur={(e) => updatePlato(cat.id, it.id, "precio", corregirPrecio(e.target.value))}
                          placeholder="0.00"
                        />
                      )}
                    </div>

                    {it.variantes.length === 0 ? (
                      <button
                        style={{ ...S.btnGhostSmall, marginTop: 6 }}
                        onClick={() => activarVariantes(cat.id, it.id)}
                      >
                        <Plus size={12} /> Varios precios (tapa / media / ración)
                      </button>
                    ) : (
                      <div style={{ marginTop: 8 }}>
                        {it.variantes.map((v) => (
                          <div key={v.id} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                            <input
                              style={{ ...S.input, flex: 2 }}
                              value={v.nombre}
                              onChange={(e) => updateVariante(cat.id, it.id, v.id, "nombre", e.target.value)}
                              onBlur={(e) => updateVariante(cat.id, it.id, v.id, "nombre", capitalizarFrase(e.target.value))}
                              placeholder="Ej. Tapa"
                            />
                            <input
                              style={{ ...S.input, flex: 1 }}
                              value={v.precio}
                              onChange={(e) => updateVariante(cat.id, it.id, v.id, "precio", e.target.value)}
                              onBlur={(e) => corregirYOrdenarVariante(cat.id, it.id, v.id, e.target.value)}
                              placeholder="0.00"
                            />
                            <button
                              style={S.iconBtnDanger}
                              onClick={() => removeVariante(cat.id, it.id, v.id)}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))}
                        <div style={{ display: "flex", gap: 8 }}>
                          <button style={S.btnGhostSmall} onClick={() => addVariante(cat.id, it.id)}>
                            <Plus size={12} /> Añadir otro precio
                          </button>
                          <button style={S.btnGhostSmall} onClick={() => desactivarVariantes(cat.id, it.id)}>
                            Volver a precio único
                          </button>
                        </div>
                      </div>
                    )}

                    {it.foto && (
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        <button
                          style={S.btnGhostSmall}
                          onClick={() => {
                            setObjetivoFotoPlato({ catId: cat.id, itemId: it.id });
                            fotoPlatoInputRef.current?.click();
                          }}
                        >
                          Cambiar foto
                        </button>
                        <button style={S.btnGhostSmall} onClick={() => updatePlato(cat.id, it.id, "foto", null)}>
                          Quitar foto
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <input
                  style={{ ...S.input, marginTop: 6 }}
                  value={it.desc}
                  onChange={(e) => updatePlato(cat.id, it.id, "desc", e.target.value)}
                  placeholder="Descripción (opcional)"
                />

                {/* Grupos de opciones: ej. "Tipo de pan" con Natural / Integral / Pan de horno (+0,50€) */}
                {(it.grupos || []).map((g) => (
                  <div key={g.id} style={S.grupoOpcionesCard}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <input
                        style={{ ...S.input, flex: 1 }}
                        value={g.titulo}
                        onChange={(e) => updateTituloGrupo(cat.id, it.id, g.id, e.target.value)}
                        onBlur={(e) => updateTituloGrupo(cat.id, it.id, g.id, capitalizarFrase(e.target.value))}
                        placeholder="Ej. Tipo de pan"
                      />
                      <button style={S.iconBtnDanger} onClick={() => removeGrupoOpciones(cat.id, it.id, g.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {g.opciones.map((o) => (
                      <div key={o.id} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                        <input
                          style={{ ...S.input, flex: 2 }}
                          value={o.nombre}
                          onChange={(e) => updateOpcion(cat.id, it.id, g.id, o.id, "nombre", e.target.value)}
                          onBlur={(e) =>
                            updateOpcion(cat.id, it.id, g.id, o.id, "nombre", capitalizarFrase(e.target.value))
                          }
                          placeholder="Ej. Pan de horno"
                        />
                        <input
                          style={{ ...S.input, flex: 1 }}
                          value={o.precio}
                          onChange={(e) => updateOpcion(cat.id, it.id, g.id, o.id, "precio", e.target.value)}
                          placeholder="+0.00 (opcional)"
                        />
                        <button style={S.iconBtnDanger} onClick={() => removeOpcion(cat.id, it.id, g.id, o.id)}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    <button style={S.btnGhostSmall} onClick={() => addOpcionAGrupo(cat.id, it.id, g.id)}>
                      <Plus size={12} /> Añadir opción
                    </button>
                  </div>
                ))}
                <button
                  style={{ ...S.btnGhostSmall, marginTop: 8 }}
                  onClick={() => addGrupoOpciones(cat.id, it.id)}
                >
                  <Plus size={12} /> Añadir opciones a elegir (ej. tipo de pan)
                </button>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {ALERGENOS.map((a) => (
                    <button
                      key={a}
                      style={{
                        ...S.alergenoChip,
                        ...(it.alergenos.includes(a) ? S.alergenoChipActivo : {}),
                      }}
                      onClick={() => toggleAlergeno(cat.id, it.id, a)}
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                  <button
                    style={{
                      ...S.dispToggle,
                      background: it.disponible ? "#2E5B3E" : "#5A5548",
                    }}
                    onClick={() => updatePlato(cat.id, it.id, "disponible", !it.disponible)}
                  >
                    {it.disponible ? <Check size={13} /> : <X size={13} />}
                    {it.disponible ? "Disponible" : "Agotado"}
                  </button>
                  <button style={S.iconBtn} onClick={() => duplicarPlato(cat.id, it.id)} title="Duplicar plato">
                    <Copy size={14} />
                  </button>
                  <button style={S.iconBtnDanger} onClick={() => eliminarPlato(cat.id, it.id, it.nombre)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            <button style={S.btnGhostSmall} onClick={() => addPlato(cat.id)}>
              <Plus size={14} /> Añadir plato
            </button>
          </div>
        ))}

        <button style={{ ...S.btnPrimary, marginTop: 8 }} onClick={addCategoria}>
          <Plus size={16} /> Añadir categoría
        </button>
      </div>
    </div>
  );
}

// Traduce nombre/desc de una carta al inglés manteniendo estructura, ids y precios intactos
async function traducirCartaAlIngles(carta) {
  const payload = {
    categorias: carta.categorias.map((cat) => ({
      nombre: cat.nombre,
      items: cat.items.map((it) => ({
        nombre: it.nombre,
        desc: it.desc,
        variantes: (it.variantes || []).map((v) => ({ nombre: v.nombre })),
        grupos: (it.grupos || []).map((g) => ({
          titulo: g.titulo,
          opciones: g.opciones.map((o) => ({ nombre: o.nombre })),
        })),
      })),
    })),
  };
  const response = await fetch("/api/traducir-carta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("Respuesta vacía");
  const clean = textBlock.text.replace(/```json|```/g, "").trim();
  const traducido = JSON.parse(clean);

  // Reconstruye manteniendo ids, precios, alérgenos, disponibilidad y fotos originales
  return carta.categorias.map((cat, i) => ({
    ...cat,
    nombre: traducido.categorias?.[i]?.nombre || cat.nombre,
    items: cat.items.map((it, j) => ({
      ...it,
      nombre: traducido.categorias?.[i]?.items?.[j]?.nombre || it.nombre,
      desc: traducido.categorias?.[i]?.items?.[j]?.desc ?? it.desc,
      variantes: (it.variantes || []).map((v, k) => ({
        ...v,
        nombre: traducido.categorias?.[i]?.items?.[j]?.variantes?.[k]?.nombre || v.nombre,
      })),
      grupos: (it.grupos || []).map((g, k) => ({
        ...g,
        titulo: traducido.categorias?.[i]?.items?.[j]?.grupos?.[k]?.titulo || g.titulo,
        opciones: g.opciones.map((o, m) => ({
          ...o,
          nombre: traducido.categorias?.[i]?.items?.[j]?.grupos?.[k]?.opciones?.[m]?.nombre || o.nombre,
        })),
      })),
    })),
  }));
}

// ---------- Carta pública ----------
function CartaPublica({ restaurantes, slugInicial, onVolver }) {
  const [slug, setSlug] = useState(normalizarSlug(slugInicial));
  const [idioma, setIdioma] = useState("es");
  const [traduccionCache, setTraduccionCache] = useState({}); // { [cartaId]: categorias traducidas }
  const [traduciendo, setTraduciendo] = useState(false);
  const [errorTraduccion, setErrorTraduccion] = useState("");
  const [mostrarFiltro, setMostrarFiltro] = useState(false);
  const [alergenosExcluir, setAlergenosExcluir] = useState([]);

  const restaurante = restaurantes.find((r) => r.slug === slug);

  // Título de la pestaña + meta descripción dinámicos (ayuda también a que Google
  // indexe cada carta con su propio nombre, no siempre el mismo título genérico).
  useEffect(() => {
    if (restaurante) {
      document.title = `${restaurante.nombre} — Carta`;
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) metaDesc.setAttribute("content", `Consulta la carta de ${restaurante.nombre} online.`);
    }
    return () => {
      document.title = "Mejores Cartas — Cartas digitales para restaurantes";
    };
  }, [restaurante]);

  if (!restaurante) {
    return (
      <div style={S.center}>
        <TopBar title="Carta no encontrada" onBack={onVolver} minimal />
        <p style={S.muted}>No existe ninguna carta en /{slug}.</p>
      </div>
    );
  }

  // Bloqueo si el restaurante tiene el pago pendiente
  if (restaurante.pago === "pendiente") {
    return (
      <div style={S.center}>
        <TopBar title={restaurante.nombre} onBack={onVolver} minimal />
        <div style={S.card}>
          <Lock size={20} color="#C9A227" style={{ marginBottom: 10 }} />
          <div style={S.eyebrow}>Carta no disponible</div>
          <p style={S.muted}>
            Esta carta está temporalmente desactivada. Si eres el restaurante, contacta con tu proveedor para
            reactivarla.
          </p>
        </div>
      </div>
    );
  }

  const carta = restaurante.cartas.find((c) => c.id === restaurante.cartaActivaId) || restaurante.cartas[0];
  const categoriasVisibles =
    idioma === "en" && traduccionCache[carta.id] ? traduccionCache[carta.id] : carta.categorias;

  const toggleIdioma = async () => {
    if (idioma === "en") {
      setIdioma("es");
      return;
    }
    setIdioma("en");
    if (traduccionCache[carta.id]) return;
    setTraduciendo(true);
    setErrorTraduccion("");
    try {
      const traducidas = await traducirCartaAlIngles(carta);
      setTraduccionCache((prev) => ({ ...prev, [carta.id]: traducidas }));
    } catch (e) {
      setErrorTraduccion("No se pudo traducir la carta ahora mismo.");
      setIdioma("es");
    } finally {
      setTraduciendo(false);
    }
  };

  const toggleAlergenoFiltro = (a) => {
    setAlergenosExcluir((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  };

  return (
    <div style={S.publicWrap}>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 18 }}>
        <button style={S.langToggle} onClick={toggleIdioma} disabled={traduciendo}>
          {traduciendo ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
          {idioma === "es" ? "EN" : "ES"}
        </button>
      </div>

      <div style={S.publicHeader}>
        {restaurante.logoImage ? (
          <div style={S.publicLogoWrap}>
            <img src={restaurante.logoImage} alt={restaurante.nombre} style={S.publicLogoImg} />
          </div>
        ) : (
          <div style={S.publicLogo}>{restaurante.logoEmoji}</div>
        )}
        <div style={S.publicOrnamentTop}>· · ·</div>
        <h1 style={S.publicH1}>{restaurante.nombre}</h1>
        <div style={S.publicSub}>{carta.nombre}</div>
        {(restaurante.direccion || restaurante.telefono) && (
          <div style={S.publicContacto}>
            {restaurante.direccion && <span>{restaurante.direccion}</span>}
            {restaurante.direccion && restaurante.telefono && <span> · </span>}
            {restaurante.telefono && <span>{restaurante.telefono}</span>}
          </div>
        )}
      </div>

      {errorTraduccion && <div style={{ ...S.errorText, textAlign: "center", marginBottom: 14 }}>{errorTraduccion}</div>}

      {/* Filtro de alérgenos */}
      <div style={{ marginBottom: 30, textAlign: "center" }}>
        <button style={S.btnGhostSmall} onClick={() => setMostrarFiltro((v) => !v)}>
          <Filter size={13} /> {idioma === "en" ? "Allergen filter" : "Filtrar alérgenos"}
          {alergenosExcluir.length > 0 ? ` (${alergenosExcluir.length})` : ""}
        </button>
        {mostrarFiltro && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10, justifyContent: "center" }}>
            {ALERGENOS.map((a) => (
              <button
                key={a}
                style={{
                  ...S.alergenoChip,
                  ...(alergenosExcluir.includes(a) ? S.alergenoChipExcluido : {}),
                }}
                onClick={() => toggleAlergenoFiltro(a)}
              >
                {traducirAlergeno(a, idioma)}
              </button>
            ))}
          </div>
        )}
      </div>

      {categoriasVisibles.length === 0 && (
        <p style={{ ...S.muted, textAlign: "center" }}>
          {idioma === "en" ? "This menu has no dishes yet." : "Esta carta todavía no tiene platos cargados."}
        </p>
      )}

      {categoriasVisibles.map((cat) => (
        <div key={cat.id} style={{ marginBottom: 40 }}>
          <div style={S.publicCatTitle}>{cat.nombre}</div>
          <div style={S.publicDivider} />
          {cat.items.map((it) => {
            const contieneExcluido = it.alergenos.some((a) => alergenosExcluir.includes(a));
            return (
              <div key={it.id} style={{ ...S.publicItem, opacity: it.disponible ? 1 : 0.4 }}>
                {it.foto && <img src={it.foto} alt={it.nombre} style={S.publicItemFoto} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {it.variantes.length > 0 ? (
                    <>
                      <span style={S.publicItemName}>{it.nombre}</span>
                      {[...it.variantes]
                        .sort((a, b) => (parseFloat(a.precio) || 0) - (parseFloat(b.precio) || 0))
                        .map((v) => (
                          <div key={v.id} style={S.publicItemLinea}>
                            <span style={S.publicVarianteNombre}>{v.nombre}</span>
                            <span style={S.publicDots} />
                            <span style={S.publicPrice}>{v.precio} €</span>
                          </div>
                        ))}
                    </>
                  ) : (
                    <div style={S.publicItemLinea}>
                      <span style={S.publicItemName}>{it.nombre}</span>
                      <span style={S.publicDots} />
                      <span style={S.publicPrice}>{it.precio} €</span>
                    </div>
                  )}
                  {!it.disponible && (
                    <span style={S.agotadoTag}>{idioma === "en" ? "Sold out" : "Agotado"}</span>
                  )}
                  {it.desc && <div style={S.publicItemDesc}>{it.desc}</div>}
                  {(it.grupos || []).map((g) => (
                    <div key={g.id} style={S.publicGrupoOpciones}>
                      <span style={S.publicGrupoTitulo}>{g.titulo}: </span>
                      {g.opciones
                        .map((o) => (o.precio ? `${o.nombre} (+${o.precio} €)` : o.nombre))
                        .join(" · ")}
                    </div>
                  ))}
                  {it.alergenos.length > 0 && (
                    <div style={S.publicAlergenos}>
                      {idioma === "en" ? "Allergens" : "Alérgenos"}: {it.alergenos.map((a) => traducirAlergeno(a, idioma)).join(", ")}
                    </div>
                  )}
                  {contieneExcluido && (
                    <div style={S.avisoAlergeno}>
                      ⚠ {idioma === "en" ? "Contains an allergen you filtered" : "Contiene un alérgeno filtrado"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <div style={S.publicFooterMark}>· {restaurante.nombre} ·</div>
    </div>
  );
}

// ---------- Cartel QR para imprimir ----------
function CartelQR({ restaurantes, slug, onVolver }) {
  const restaurante = restaurantes.find((r) => r.slug === normalizarSlug(slug));
  if (!restaurante) {
    return (
      <div style={S.center}>
        <TopBar title="Restaurante no encontrado" onBack={onVolver} minimal />
      </div>
    );
  }
  // Ahora que la web ya vive en tu dominio real, el QR apunta a la URL de verdad
  // (window.location.origin coge automáticamente tu dominio, sea cual sea).
  const urlReal = `${typeof window !== "undefined" ? window.location.origin : ""}/${restaurante.slug}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(
    urlReal
  )}`;

  return (
    <div style={S.page}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
      <div className="no-print">
        <TopBar title="Cartel para imprimir" onBack={onVolver} />
        <div style={{ ...S.muted, marginBottom: 16 }}>
          Este QR lleva directamente a: <b>{urlReal}</b>
        </div>
        <button style={{ ...S.btnPrimary, marginBottom: 20 }} onClick={() => window.print()}>
          <Printer size={16} /> Imprimir cartel
        </button>
      </div>

      <div style={S.cartelWrap}>
        {restaurante.logoImage ? (
          <div style={S.cartelLogoWrap}>
            <img src={restaurante.logoImage} alt={restaurante.nombre} style={S.cartelLogo} />
          </div>
        ) : (
          <div style={S.cartelLogoEmoji}>{restaurante.logoEmoji}</div>
        )}
        <div style={S.cartelNombre}>{restaurante.nombre}</div>
        <div style={S.cartelLinea} />
        <img src={qrSrc} alt="Código QR" style={S.cartelQR} />
        <div style={S.cartelCTA}>Escanea para ver la carta</div>
        <div style={S.cartelFooter}>{restaurante.slug}</div>
      </div>
    </div>
  );
}

// ---------- Componentes compartidos ----------
function Logo({ restaurante, size = 36, radius = 9, fontSize = 17 }) {
  if (restaurante.logoImage) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: "#171614",
          border: "1px solid #34312A",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <img
          src={restaurante.logoImage}
          alt={restaurante.nombre}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "#171614",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize,
      }}
    >
      {restaurante.logoEmoji}
    </div>
  );
}

function TopBar({ title, onBack, right, minimal, backIcon }) {
  return (
    <div style={{ ...S.topBar, ...(minimal ? { border: "none", marginBottom: 20 } : {}) }}>
      <button style={S.backBtn} onClick={onBack}>
        {backIcon || <ArrowLeft size={16} />}
      </button>
      <div style={S.topBarTitle}>{title}</div>
      {right}
    </div>
  );
}

// ---------- Estilos ----------
const F = {
  display: "'Fraunces', 'Georgia', serif",
  body: "'Inter', system-ui, sans-serif",
};

const S = {
  app: {
    minHeight: "100vh",
    background: "#171614",
    color: "#EDE7DA",
    fontFamily: F.body,
    overflowX: "hidden",
  },
  loadingScreen: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "#171614",
  },
  toastGuardado: {
    position: "fixed",
    bottom: 20,
    left: "50%",
    transform: "translateX(-50%)",
    background: "#2E5B3E",
    color: "#EDE7DA",
    padding: "8px 18px",
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    zIndex: 999,
    boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
  },
  page: { padding: "20px 16px 60px", maxWidth: 640, margin: "0 auto" },
  center: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px 20px 60px",
  },
  logoMark: {
    width: 56,
    height: 56,
    borderRadius: 14,
    background: "#C9A227",
    color: "#171614",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 16px",
  },
  wordmark: {
    fontFamily: F.display,
    fontSize: 30,
    margin: 0,
    letterSpacing: 3,
    fontWeight: 700,
    color: "#C9A227",
  },
  h1: { fontFamily: F.display, fontSize: 26, margin: 0, letterSpacing: 2, fontWeight: 600 },
  sub: { color: "#B8B2A6", marginTop: 8, fontSize: 14 },
  card: {
    background: "#211F1B",
    border: "1px solid #34312A",
    borderRadius: 14,
    padding: 18,
    width: "100%",
    maxWidth: 460,
  },
  eyebrow: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: "#C9A227",
    marginBottom: 10,
    fontWeight: 600,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    background: "#171614",
    border: "1px solid #3A362E",
    borderRadius: 8,
    padding: "10px 12px",
    color: "#EDE7DA",
    fontSize: 14,
    fontFamily: F.body,
    outline: "none",
  },
  btnPrimary: {
    background: "#C9A227",
    color: "#171614",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    fontWeight: 700,
    fontSize: 14,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  btnGhost: {
    background: "transparent",
    color: "#EDE7DA",
    border: "1px solid #3A362E",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
  },
  btnGhostSmall: {
    background: "transparent",
    color: "#C9A227",
    border: "1px solid #3A362E",
    borderRadius: 7,
    padding: "6px 10px",
    fontSize: 12,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    cursor: "pointer",
    fontWeight: 600,
  },
  chip: {
    background: "#171614",
    border: "1px solid #3A362E",
    color: "#B8B2A6",
    borderRadius: 20,
    padding: "6px 12px",
    fontSize: 12,
    cursor: "pointer",
  },
  adminFooterLink: {
    background: "transparent",
    border: "none",
    color: "#4A473E",
    fontSize: 11,
    marginTop: 40,
    cursor: "pointer",
    textDecoration: "underline",
  },
  muted: { color: "#8A8478", fontSize: 13 },
  errorText: { color: "#E08585", fontSize: 12, marginTop: 8 },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "#B8B2A6",
    marginTop: 12,
    cursor: "pointer",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    paddingBottom: 16,
    marginBottom: 16,
    borderBottom: "1px solid #2A281F",
  },
  topBarTitle: { fontFamily: F.display, fontSize: 19, flex: 1 },
  backBtn: {
    background: "#211F1B",
    border: "1px solid #34312A",
    color: "#EDE7DA",
    borderRadius: 8,
    width: 34,
    height: 34,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  rowCard: {
    background: "#211F1B",
    border: "1px solid #34312A",
    borderRadius: 12,
    padding: "12px 14px",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 9,
    background: "#171614",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 17,
  },
  rowTitle: { fontSize: 14, fontWeight: 600, wordBreak: "break-word" },
  rowSub: { fontSize: 11, color: "#8A8478" },
  slugInlineInput: {
    background: "#171614",
    border: "1px solid #34312A",
    borderRadius: 6,
    color: "#C9A227",
    fontSize: 11,
    padding: "3px 7px",
    outline: "none",
    minWidth: 90,
    maxWidth: "100%",
  },
  badge: {
    fontSize: 10,
    padding: "4px 9px",
    borderRadius: 20,
    fontWeight: 700,
    color: "#EDE7DA",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  iconBtn: {
    background: "#171614",
    border: "1px solid #34312A",
    color: "#C9A227",
    borderRadius: 8,
    width: 30,
    height: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  iconBtnDanger: {
    background: "transparent",
    border: "1px solid #4A2A2A",
    color: "#E08585",
    borderRadius: 8,
    width: 30,
    height: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  cartaTab: {
    background: "#171614",
    border: "1px solid #3A362E",
    borderRadius: 10,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 180,
  },
  cartaTabActiva: { border: "1px solid #C9A227" },
  cartaTabInput: {
    background: "transparent",
    border: "none",
    color: "#EDE7DA",
    fontSize: 14,
    fontWeight: 600,
    outline: "none",
    fontFamily: F.body,
  },
  badgeActiva: {
    fontSize: 11,
    color: "#7FBF8E",
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontWeight: 600,
  },
  catCard: {
    background: "#1C1A16",
    border: "1px solid #2A281F",
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  catInput: {
    flex: 1,
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #3A362E",
    color: "#C9A227",
    fontFamily: F.display,
    fontSize: 16,
    padding: "4px 0",
    outline: "none",
  },
  itemCard: {
    background: "#171614",
    border: "1px solid #2A281F",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  grupoOpcionesCard: {
    background: "#1C1A16",
    border: "1px solid #34312A",
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  platoFotoThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    objectFit: "cover",
    flexShrink: 0,
    border: "1px solid #34312A",
  },
  platoFotoVacia: {
    width: 56,
    height: 56,
    borderRadius: 8,
    flexShrink: 0,
    background: "#1C1A16",
    border: "1px dashed #3A362E",
    color: "#6A6558",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  alergenoChip: {
    fontSize: 10,
    padding: "4px 8px",
    borderRadius: 20,
    border: "1px solid #3A362E",
    background: "transparent",
    color: "#8A8478",
    cursor: "pointer",
  },
  alergenoChipActivo: {
    border: "1px solid #C9A227",
    color: "#C9A227",
  },
  alergenoChipExcluido: {
    border: "1px solid #7A2E2E",
    background: "#2A1414",
    color: "#E08585",
  },
  langToggle: {
    background: "#211F1B",
    border: "1px solid #34312A",
    color: "#C9A227",
    borderRadius: 20,
    padding: "6px 12px",
    fontSize: 11,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    cursor: "pointer",
  },
  avisoAlergeno: {
    fontSize: 10.5,
    color: "#E08585",
    marginTop: 4,
    fontWeight: 600,
  },
  publicItemFoto: {
    width: 54,
    height: 54,
    borderRadius: 8,
    objectFit: "cover",
    flexShrink: 0,
  },
  dispToggle: {
    border: "none",
    borderRadius: 20,
    color: "#EDE7DA",
    padding: "5px 12px",
    fontSize: 11,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    cursor: "pointer",
  },
  publicWrap: {
    maxWidth: 560,
    margin: "0 auto",
    padding: "28px 24px 70px",
  },
  publicBack: {
    background: "transparent",
    border: "none",
    color: "#7A7468",
    fontSize: 13,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    padding: 0,
  },
  publicHeader: { textAlign: "center", marginBottom: 20 },
  publicLogo: { fontSize: 44, marginBottom: 8 },
  publicLogoWrap: {
    width: 84,
    height: 84,
    borderRadius: 20,
    background: "#0F0E0C",
    border: "1px solid #34312A",
    margin: "0 auto 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  publicLogoImg: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  publicOrnamentTop: { color: "#5A5548", letterSpacing: 4, fontSize: 11, marginBottom: 10 },
  publicH1: {
    fontFamily: F.display,
    fontSize: 32,
    margin: 0,
    letterSpacing: 0.3,
    fontWeight: 600,
    wordBreak: "break-word",
  },
  publicSub: {
    color: "#C9A227",
    fontSize: 11,
    marginTop: 10,
    letterSpacing: 3,
    textTransform: "uppercase",
    fontWeight: 600,
  },
  publicContacto: {
    color: "#8A8478",
    fontSize: 11.5,
    marginTop: 8,
  },
  publicCatTitle: {
    fontFamily: F.display,
    fontSize: 15,
    color: "#C9A227",
    textAlign: "center",
    letterSpacing: 3,
    textTransform: "uppercase",
    fontWeight: 600,
    wordBreak: "break-word",
  },
  publicDivider: {
    width: 34,
    height: 1,
    background: "#C9A227",
    margin: "10px auto 26px",
    opacity: 0.5,
  },
  publicItem: {
    display: "flex",
    gap: 14,
    padding: "14px 0",
    borderBottom: "1px solid #232019",
  },
  publicItemLinea: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    rowGap: 2,
    gap: 8,
  },
  publicItemName: {
    fontFamily: F.display,
    fontSize: 16.5,
    fontWeight: 600,
    color: "#F0EAE0",
    whiteSpace: "normal",
    wordBreak: "break-word",
    minWidth: 0,
  },
  publicDots: {
    flex: 1,
    borderBottom: "1px dotted #3A362E",
    marginBottom: 4,
    minWidth: 16,
  },
  publicVarianteNombre: {
    fontSize: 13,
    color: "#B8B2A6",
    whiteSpace: "normal",
    wordBreak: "break-word",
    minWidth: 0,
  },
  publicItemDesc: {
    fontSize: 12.5,
    color: "#9B9384",
    marginTop: 5,
    lineHeight: 1.55,
    fontStyle: "italic",
    fontFamily: F.display,
    fontWeight: 400,
  },
  publicGrupoOpciones: { fontSize: 11.5, color: "#9B9384", marginTop: 5, lineHeight: 1.5 },
  publicGrupoTitulo: { color: "#C9A227", fontWeight: 600 },
  publicAlergenos: { fontSize: 10.5, color: "#6E685C", marginTop: 6, letterSpacing: 0.3 },
  publicPrice: {
    fontFamily: F.display,
    fontSize: 16,
    color: "#C9A227",
    whiteSpace: "nowrap",
    fontWeight: 600,
  },
  agotadoTag: {
    fontSize: 9,
    border: "1px solid #4A2A2A",
    background: "transparent",
    color: "#C97B7B",
    padding: "2px 8px",
    borderRadius: 20,
    fontWeight: 600,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    display: "inline-block",
    marginTop: 6,
  },
  publicFooterMark: {
    textAlign: "center",
    color: "#3A362E",
    fontSize: 11,
    letterSpacing: 3,
    marginTop: 30,
    textTransform: "uppercase",
  },
  cartelWrap: {
    background: "#FBF8F2",
    color: "#171614",
    borderRadius: 4,
    padding: "56px 36px",
    textAlign: "center",
    maxWidth: 420,
    margin: "0 auto",
    border: "1px solid #D9D2C2",
  },
  cartelLogoWrap: {
    width: 88,
    height: 88,
    borderRadius: 18,
    background: "#FFFFFF",
    border: "1px solid #D9D2C2",
    margin: "0 auto 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cartelLogo: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  cartelLogoEmoji: { fontSize: 50, marginBottom: 12 },
  cartelNombre: { fontFamily: F.display, fontSize: 27, fontWeight: 600, letterSpacing: 0.3 },
  cartelLinea: { width: 40, height: 1, background: "#C9A227", margin: "20px auto" },
  cartelQR: { width: 200, height: 200, margin: "0 auto" },
  cartelCTA: {
    fontFamily: F.display,
    fontSize: 14,
    marginTop: 22,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "#5A5548",
  },
  cartelFooter: { fontSize: 10.5, color: "#A39C8C", marginTop: 10, letterSpacing: 1 },
};
