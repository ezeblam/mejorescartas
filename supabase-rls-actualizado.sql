-- ⚠️ IMPORTANTE: ejecuta esto en Supabase (SQL Editor) ANTES de subir el nuevo código.
-- Cambia el comportamiento de la base de datos: antes cualquiera con la clave pública
-- de la web podía escribir directamente en la base de datos (crear, editar, borrar
-- restaurantes) sin pasar por ningún control. A partir de ahora, esa clave pública
-- SOLO puede leer datos — escribir requiere pasar por las funciones de servidor,
-- que sí comprueban la contraseña correspondiente antes de aceptar el cambio.

-- Quitamos la política antigua (permitía todo, leer y escribir, a cualquiera)
drop policy if exists "Acceso publico app_data" on app_data;

-- Nueva política: solo lectura pública
create policy "Lectura publica app_data"
  on app_data
  for select
  using (true);

-- No se crea ninguna política de insert/update/delete para el rol público (anon).
-- Sin política explícita, esas operaciones quedan bloqueadas para la clave pública.
-- Las funciones de servidor usan una clave distinta (Service Role Key), que se
-- salta estas reglas por diseño de Supabase — por eso ellas sí pueden escribir.
