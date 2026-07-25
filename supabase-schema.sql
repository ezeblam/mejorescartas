-- Ejecuta esto en Supabase: panel del proyecto → "SQL Editor" → pega y dale a "Run"

create table app_data (
  key text primary key,
  value jsonb
);

-- Habilitamos acceso (necesario para que la web pueda leer/escribir).
-- Nota: esto da acceso de lectura/escritura a quien tenga la clave pública (anon key),
-- que es el mismo modelo de seguridad que teníamos en el prototipo de pruebas.
-- Es válido para el arranque; si el negocio crece, se puede reforzar más adelante
-- limitando la escritura solo a través de las funciones de servidor.
alter table app_data enable row level security;

create policy "Acceso publico app_data"
  on app_data
  for all
  using (true)
  with check (true);
