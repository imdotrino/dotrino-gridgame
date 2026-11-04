# GridGame

> **Parte del ecosistema [Dotrino](https://dotrino.com).** Dotrino es un ecosistema de aplicaciones centradas en la privacidad de los datos: tu información es tuya, y las decisiones sobre ella también — qué compartes, con quién, cuándo y por qué. Sin anuncios, sin cookies, sin rastreo de datos, sin vender tu identidad a nadie.

Sandbox multijugador cooperativo en un grid del ecosistema [Dotrino](https://dotrino.github.io/dotrino/). Mundo subjetivo: cada peer hostea lo que crea y carga el entorno alrededor a medida que se mueve.

## Filosofía

El eje del ecosistema **[Dotrino](https://dotrino.com)** es el **autohosteo** y el **control sobre la propia información**: qué comparto, cómo lo comparto y cuándo lo comparto.

### Manifiesto

> **Tu información, en tu servidor, bajo tus reglas.**
> Dotrino nace de una idea simple: lo que es tuyo, se queda contigo. Tú decides **qué** compartes, **cómo** lo compartes y **cuándo** lo compartes. Sin intermediarios, sin nubes ajenas, sin letra pequeña.
>
> Cada aplicación del ecosistema Dotrino vive donde tú quieras: tu propio servidor, tu propia infraestructura. Tus datos no viajan a empresas que los monetizan. Tú eres el dueño y el administrador. Compartes solo lo que eliges, con quien eliges, durante el tiempo que eliges.

### Tres pilares

> - **Qué comparto:** solo la información que decido exponer, nada más.
> - **Cómo lo comparto:** con el formato, el acceso y las condiciones que yo defino.
> - **Cuándo lo comparto:** en el momento que quiero, y lo retiro cuando quiero.
>
> Todo sobre infraestructura que tú controlas. Eso es autohosteo. Eso es soberanía digital.

---

## La red: todo lo tuyo va sellado

El proxio (`proxy.dotrino.com`) **enruta pero no cifra**. Lo que una partida manda es del
jugador —dónde estás, qué construyes, a quién le pegas—, así que va dentro de un sobre
hacia la llave de cifrado de la bóveda del destinatario (CONVENCIONES §4.1). El cliente
arranca con `requireSealed: true`, que corta en las **dos** direcciones: ni manda ni
acepta nada dirigido en claro.

- **Sin bóveda no se juega en red.** No hay con qué sellar ni con qué abrir; la partida es
  de un jugador y la pantalla lo dice, en vez de hablar en claro «mientras tanto».
- **Lo único en claro es lo público por diseño**: el canal `gridgame` (que es la lista de
  quién está jugando, y va sin datos) y el **saludo del transporte** (`helloTo`), que
  lleva una llave pública que el proxio ya tiene atada a esa conexión desde `identify`.
  Es lo que dice de quién es cada token: sin eso no hay a quién sellarle.
- **A quien no se le puede sellar no se le manda nada**, y se ve en pantalla con su motivo
  (`no-encpub`, `encpub-unverified`, `no-encpub-support`). Callarlo dejaría a ese jugador
  en la lista sin recibir nada.

## El mapa: biomas sin cortes

- **Generador** (`src/world/ProceduralGround.js`): determinista por semilla, dos campos de
  ruido por octavas. La **altura** da agua → playa → tierras → colinas → roca; la
  **humedad** decide en las tierras medias entre desierto, tierra seca y pradera.
- **Dibujo** (`src/render/terrain.js`): autotile de **rejilla doble**. El terreno es por
  celda (lo usan colisión y velocidad), pero cada tile de pantalla va corrido medio tile y
  mira las cuatro celdas de sus esquinas: 16 formas por terreno. Cubre islas de una celda,
  tiras de una celda y contactos en diagonal, sin pedirle nada al generador.
- **Capas**: agua < arena < hierba < tierra < roca. La capa más baja de las cuatro esquinas
  va llena y cada una de encima se pinta con su forma. Un juego de 16 por terreno, no uno
  por cada par de vecinos.
- **Atlas** `public/terrain.png`: 16 px, fila = capa, columna = máscara (bits 1 NO, 2 NE,
  4 SO, 8 SE); columnas 16 y 17 son variantes del tile lleno. `scripts/terrain/template.py`
  genera la plantilla con las siluetas exactas que espera el motor, y
  `scripts/terrain/draw.py` dibuja el arte y comprueba que no se aparta de ellas.

## El personaje

`public/player.png` (48×64, frames de 16 px): fila = hacia dónde mira (abajo, izquierda,
derecha, arriba), columna = de pie, paso A, paso B. `src/render/player.js` elige la cara
según el movimiento y alterna los pasos al andar. `scripts/player/draw.py` lo regenera.

## Slime y mercader

`public/actors.png` (48×32, frames de 16 px): fila 0 el slime, fila 1 el mercader; columnas
0 quieto, 1 y 2 las dos variaciones del reposo (0 → 1 → 0 → 2). `src/render/actors.js`
elige la fila por `payload.name` y desfasa el ciclo por id para que no laten todos a la vez.
Un actor sin fila sigue saliendo como rectángulo de color. `scripts/actors/draw.py` lo
regenera. En el juego: **E** invoca un slime y **M** pone un mercader a tu lado.

## Volver a donde estabas

La posición es del jugador, así que vive en el almacén del perfil (`@dotrino/store`, hilo
`gridgame.position`, respaldado en la bóveda), no en `localStorage`. Se escribe como mucho
una vez por segundo mientras te mueves y al ocultarse la pestaña (`src/save.js`). Si el
almacén no abre, la pantalla lo dice: sin aviso, volver al origen parecería un fallo.

## Pruebas

```bash
npm test             # unitarias, sin DOM ni red (mundo, DSL, store)
npm run test:e2e     # punta a punta: DOS navegadores de verdad por el proxio real
```

`tests/sealed-net.e2e.mjs` es la que responde la pregunta que importa: **graba todo lo que
entra y sale por el socket en los dos extremos** y comprueba que ahí no aparecen ni las
posiciones ni los objetos; que la partida funciona (uno se mueve, construye, y le aparece
al otro); y que el fallo se distingue por `code` sin caer nunca a mandar en claro.

```bash
npx playwright install chromium
npm run build && npm run preview -- --port 4181 &
npm run test:e2e                  # o GRIDGAME_BASE=https://gridgame.dotrino.com/
```
