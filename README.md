# Rumbo

**Rumbo** es una web privada para dos personas (por ejemplo, una pareja) donde llevar en común:

- **Vuestros ahorros**: cuánto tenéis en total, cuánto está reservado para cada objetivo y cuánto queda disponible.
- **Vuestros objetivos**: la entrada de un piso, un viaje, la boda, un fondo de emergencia… con su meta, su desglose, su fecha deseada y su progreso.
- **Las tareas** que faltan para conseguir cada objetivo.

No hay usuarios ni contraseñas. Se entra con un **enlace privado** que crearéis al empezar. Los dos usáis el mismo enlace y los cambios aparecen en el otro dispositivo en unos segundos.

La web son archivos estáticos (HTML, CSS y JavaScript) que se publican gratis con **GitHub Pages**. Los datos se guardan en una base de datos gratuita de **Supabase**. No hace falta servidor propio, ni instalar nada, ni saber programar.

---

## Puesta en marcha (unos 15 minutos, solo una vez)

### 1. Crea un proyecto gratuito en Supabase

1. Entra en [supabase.com](https://supabase.com) y crea una cuenta (puedes usar tu cuenta de GitHub).
2. Pulsa **New project**.
3. Ponle un nombre (por ejemplo, `rumbo`), escribe una contraseña para la base de datos (guárdala, aunque esta web no la necesita) y elige una región cercana (por ejemplo, *West EU*).
4. Elige el plan **Free** y pulsa **Create new project**. Tarda un par de minutos en estar listo.

### 2. Crea la base de datos (SQL Editor → pegar `supabase/schema.sql` → Run)

1. En el menú de la izquierda del proyecto, abre **SQL Editor**.
2. Abre el archivo `supabase/schema.sql` de este repositorio, selecciona **todo** su contenido y cópialo.
3. Pégalo en el SQL Editor y pulsa **Run**.
4. Debe terminar sin errores (verás «Success. No rows returned»). Si Supabase te pregunta si quieres ejecutar una consulta con operaciones «destructivas», confírmalo: el script se puede ejecutar varias veces y **no borra datos**.

> Si en el futuro actualizas la web con una versión nueva, repite este paso con el `schema.sql` nuevo.

### 3. Copia la dirección del proyecto y la clave pública en `config.js`

1. En Supabase, abre **Project Settings** (el engranaje) → **API** (en algunas cuentas se llama **Data API** y **API Keys**). También lo tienes en el botón **Connect** de la parte superior.
2. Copia estos dos datos:
   - **Project URL**: algo como `https://abcdefghijklmnop.supabase.co`.
   - La clave **pública**: la que se llama **anon** / **anon public** (empieza por `eyJ…`) o **publishable** (empieza por `sb_publishable_…`). Cualquiera de las dos sirve.
3. Abre el archivo `config.js` de este repositorio y rellena los dos valores entre comillas:

   ```js
   window.RUMBO_CONFIG = {
     supabaseUrl: "https://abcdefghijklmnop.supabase.co",
     supabaseKey: "sb_publishable_xxxxxxxxxxxxxxxxxxxx"
   };
   ```

> **Muy importante:** usa **solo** la clave pública (*anon* o *publishable*). **Nunca** pongas en `config.js` la clave **service_role** ni la **secret** (`sb_secret_…`): dan acceso total a la base de datos y este archivo será público.

### 4. (Opcional) Código de configuración y número máximo de espacios

Como la web será pública, cualquiera que la encuentre podría crear un espacio en vuestra base de datos. Por defecto se permiten **3 espacios reales** como máximo (más que suficiente: normalmente usaréis uno). Si queréis más control:

- **Código de configuración**: si lo defines, la web pedirá ese código al pulsar «Crear nuestro espacio». La demostración no lo pide.
- **Máximo de espacios**: cambia el número de espacios reales permitidos.

En el **SQL Editor** de Supabase, ejecuta (cambiando los valores):

```sql
update rumbo.settings
   set setup_code = 'elige-aqui-vuestro-codigo',
       max_real_spaces = 3
 where id = 1;
```

Para quitar el código: `update rumbo.settings set setup_code = null where id = 1;`

### 5. Comprueba que Realtime está activo

La sincronización instantánea entre vuestros dispositivos usa **Supabase Realtime** (viene activado por defecto). Comprueba:

1. **No hace falta tocar Database → Replication** ni activar tablas para Realtime: la web solo usa mensajes **Broadcast**, que no necesitan replicación ni publicaciones.
2. En Supabase, abre **Realtime → Settings** (o **Project Settings → Realtime**) y deja **Allow public access** **activado** (es lo que viene por defecto). Si lo desactivas, solo se permiten canales privados y el indicador se quedará en «Reconectando…». La web usa canales públicos que solo transportan un número de versión, nunca datos.

Si Realtime no funcionara, la web sigue funcionando: comprueba si hay cambios cada 15 segundos y al volver a la pestaña (el indicador de la parte superior mostrará «Reconectando…»).

### 6. Sube los archivos a GitHub y activa GitHub Pages

1. Crea un repositorio nuevo en [github.com](https://github.com/new) (por ejemplo, `rumbo`). Puede ser **público** (no contiene ningún dato vuestro; ver «Seguridad» más abajo).
2. Sube **todos** los archivos y carpetas de este proyecto a la raíz del repositorio, incluido el archivo oculto `.nojekyll` y tu `config.js` ya rellenado. Desde la web de GitHub: **Add file → Upload files**, arrastra el contenido de la carpeta y pulsa **Commit changes**.
3. En el repositorio, ve a **Settings → Pages**.
4. En **Build and deployment → Source**, elige **Deploy from a branch**.
5. En **Branch**, elige **main** y la carpeta **/ (root)**. Pulsa **Save**.
6. Espera uno o dos minutos. Arriba de esa misma página aparecerá la dirección de vuestra web, del tipo `https://tu-usuario.github.io/rumbo/`.

### 7. Abre la web y cread vuestro espacio

1. Abre la dirección de GitHub Pages.
2. Pulsa **Crear nuestro espacio** (si configuraste un código en el paso 4, te lo pedirá).
3. Verás **vuestro enlace privado**, del tipo `https://tu-usuario.github.io/rumbo/#XXXXXXXX…`. **Guardadlo** (en favoritos, en vuestras notas o en un gestor de contraseñas): es la única forma de entrar.
4. Compártelo con tu pareja con **Copiar** o **Compartir** (por ejemplo, por un chat privado).
5. Pulsa **Abrir el dashboard**.

> **Cualquier persona que tenga el enlace puede ver y editar vuestro espacio.** No lo publiquéis ni lo enviéis a nadie más.

Si solo queréis curiosear antes, pulsad **Ver una demostración**: crea un espacio con datos ficticios que se borra solo a las 24 horas.

### 8. Primeros pasos dentro

1. En **Ajustes**, poned vuestros nombres.
2. En **Ahorros**, pulsad **Registrar ahorros iniciales** y escribid cuánto tenéis ahorrado hoy en total.
3. En **Resumen** (o dentro de una pestaña como «Vivienda»), pulsad **Nuevo objetivo**: nombre, meta en euros, pestaña, para quién y prioridad. En «Más opciones» podéis añadir fecha deseada, notas, un desglose del presupuesto y los primeros pasos.
4. En cada objetivo, **Añadir aportación** permite:
   - **Asignar de nuestros ahorros**: reservar para este objetivo dinero que ya teníais (sale de «Disponible»).
   - **Registrar ahorro nuevo**: dinero que entra ahora y se reserva directamente para el objetivo.
5. Añadid las **tareas** que faltan al final del detalle del objetivo («Añadir una tarea…» y Enter) y marcadlas al completarlas.
6. Cuando paguéis algo del objetivo, usad **Registrar pago** (en el menú «···» del bloque Dinero). Si el pago supera lo reservado, la web os ofrecerá cubrir la diferencia con el dinero disponible.

Nada se borra del historial: si os equivocáis en un movimiento, usad **Corregir** o **Anular** en la pestaña **Ahorros**. Si un cambio dejara algún saldo en negativo, la web no lo permitirá y os dirá qué movimiento ajustar.

### 9. Regenerar el enlace (si se ha compartido por error)

En **Ajustes → Enlace del espacio → Regenerar enlace**:

- Se crea un enlace nuevo y el anterior **deja de funcionar inmediatamente en todos los dispositivos** (incluidas las copias guardadas).
- El dispositivo desde el que regeneras pasa a usar el enlace nuevo automáticamente. Copiadlo y compartidlo de nuevo con tu pareja; en su dispositivo verá «Este enlace ya no es válido» hasta que abra el nuevo.

---

## Seguridad: cómo funciona y por qué el repositorio puede ser público

- **La clave pública de Supabase es pública por diseño.** Está pensada para ir dentro de webs y apps. Por sí sola no permite leer ni escribir vuestros datos.
- **Los datos no son accesibles directamente.** Se guardan en un esquema privado de la base de datos (`rumbo`) que Supabase no expone. Las tablas no tienen permisos para el público y además tienen la seguridad por filas activada sin ninguna regla, por si acaso.
- **Solo se accede a través de unas pocas funciones que exigen el secreto del enlace** (`rumbo_create_space`, `rumbo_get_state`, `rumbo_get_rev` y `rumbo_mutate`). Cada función comprueba el secreto y solo trabaja con los datos de ese espacio.
- **El secreto del enlace** es un valor aleatorio de 256 bits generado en vuestro navegador. Va en la parte de la dirección que está detrás de `#`, que los navegadores **nunca envían** a GitHub ni a ningún servidor al cargar la página. La web solo lo envía a Supabase dentro de las peticiones (nunca en la dirección). En la base de datos solo se guarda su huella (SHA-256), nunca el secreto en sí. La web no lo guarda en el navegador ni lo escribe en la consola.
- **El repositorio no contiene ningún dato vuestro**: solo el código de la web y la clave pública. Por eso puede ser público.
- La web no usa analítica, cookies ni recursos de terceros más allá de la librería oficial de Supabase (servida por cdn.jsdelivr.net con versión fija). Pide a los buscadores que no la indexen (`robots.txt` y etiquetas `noindex`).
- Lo que sí debéis cuidar: **quien tenga el enlace tiene acceso completo**. Si sospecháis que alguien lo tiene, regeneradlo (paso 9).

## Limitaciones

- **El plan gratuito de Supabase pausa los proyectos tras 1 semana sin actividad.** Si un día la web dice que no puede conectar con la base de datos:
  1. Entra en [supabase.com](https://supabase.com), abre tu proyecto y pulsa **Restore project** (o «Resume»).
  2. Espera unos minutos a que arranque y recarga la web. Vuestros datos siguen ahí.
  Usar la web al menos una vez por semana evita la pausa.
- Si GitHub o Supabase no están disponibles (o no hay conexión), la web no puede mostrar ni guardar datos en ese momento. Cuando un guardado falla por la conexión, la web ofrece **Reintentar** sin riesgo de duplicarlo.
- Los cálculos son orientativos (no incluyen intereses ni inflación). La web no se conecta a vuestro banco: los movimientos se registran a mano.

## Probarla en tu ordenador (opcional)

No es necesario para usarla, pero si quieres probarla antes de subirla:

- Los navegadores no permiten abrir esta web con doble clic (`file://`); hace falta servir la carpeta con **cualquier servidor estático**. Por ejemplo, si tienes Python instalado, desde la carpeta del proyecto: `python3 -m http.server 8000` y abre `http://localhost:8000/`. (Python solo se usa para probar en local; la web publicada no lo necesita.)
- **Sin Supabase:** abre `http://localhost:8000/tests/app-local.html`. Es la web completa funcionando contra una base de datos Postgres que corre dentro del propio navegador (PGlite), ejecutando el mismo `supabase/schema.sql`. Los datos se quedan solo en ese navegador y una franja indica que es el modo de pruebas. Puedes abrirla en dos pestañas para ver la sincronización.
- `tests/format-tests.html` comprueba los formatos de importes, porcentajes y fechas.
- `tests/sql-tests.html` ejecuta las pruebas de la base de datos (libro de movimientos, permisos, conflictos…) en PGlite.

## Estructura del proyecto

```
index.html              Página de la web
styles.css              Estilos
config.js               Dirección y clave pública de Supabase (rellénalo tú)
manifest.webmanifest    Datos para añadir la web a la pantalla de inicio
icon.svg                Icono
robots.txt, .nojekyll   No indexar / servir los archivos tal cual en GitHub Pages
js/                     Código de la aplicación (sin compilación)
  app.js                Arranque, sesión, ruteo y renderizado
  api.js                Llamadas a Supabase (funciones RPC) y gestión de errores
  sync.js               Sincronización en tiempo real y sondeo de respaldo
  views/, forms/        Pantallas y formularios
  backend-pglite.js     Base de datos local para tests/app-local.html (no se usa en la web publicada)
supabase/schema.sql     Base de datos: se pega una vez en el SQL Editor de Supabase
tests/                  Páginas de prueba (no hacen falta para usar la web)
```
