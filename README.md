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
regenera. En el juego, **Q** pone una roca y **M** un mercader delante de ti.

## Monstruos: nadie los invoca

Aparecen solos, en **grupos**, alrededor de cada jugador (`src/world/threat.js`,
`src/combat.js`):

- **Cuántos y cada cuánto**: lo que hosteas cerca (tus rocas, cofres, mercaderes en 8
  casillas). Sin nada construido ya hay hasta 6 vivos; construir sube el tope (24), el
  ritmo y el tamaño de cada grupo (3 a 7).
- **Siempre alejados de cualquier jugador**: cada grupo aparece a 9–14 casillas, y ningún
  monstruo a menos de 8 de ningún jugador. En una zona con mucha gente no aparecen.
- **Papeles en el grupo**: un **líder** (doble de vida, dorado y más grande) o, a veces, un
  **jefe** (×5 de vida, morado, más grande todavía, con su vida siempre a la vista);
  **normales**; y **esbirros** (media vida, más pequeños). El jefe sale más con más
  reputación, y el líder y el jefe sueltan más botín.
- **Ira** ∈ [0, 1]: la distancia a la que te ven es `ira × 10` casillas. Con ira 0 no
  atacan a nadie hasta que les pegas; pegarle a uno enfada a todo su grupo cercano. Sin
  nada a la vista, deambulan cerca de donde aparecieron.
- **Zona de memoria = 2× la pantalla, por jugador**: un grupo con todos sus miembros fuera
  de la zona de TODOS los jugadores (y a más de 16 casillas) se elimina para todos, y el
  siguiente puede salir enseguida. El doble y no la pantalla justa: si das la vuelta, el
  grupo que dejaste atrás sigue ahí. La distancia hace falta en el teléfono, donde los
  grupos ya aparecen fuera de pantalla.
- **Los monstruos de los demás** fuera de tu zona se olvidan en tu memoria (no para nadie
  más), y su dueño los reenvía cada 3 s aunque estén quietos: al volver reaparecen donde
  estén, y quien llega tarde ve los que ya había.
- **Correa**: ninguno persigue nada a más de 16 casillas de la casa de su grupo, ni
  provocado. Si lo sacas de ahí, se rinde, se calma y vuelve andando.
- **Qué tan fuertes**: tu reputación tal como la ve la red (el registro compartido). No hay
  nivel ni XP. Hasta saberla, no aparece ninguno nuevo.
- **Quién los hostea**: el jugador amenazado. Su vida, su movimiento y su golpe los decide
  él, así que para quien se defiende no hay latencia; el amigo que ayuda manda su golpe
  al dueño (`hit`). Provocados, van a por el jugador que los hostea.
- Caminan por el camino más corto (búsqueda en anchura de 12 casillas) y rompen lo que
  construiste (20 de vida).
- **Tu vida** (`src/world/life.js`): 20, se recupera sola tras 5 s sin golpes. A cero
  quedas caído **10 s** con un contador en pantalla (sin moverte ni actuar), reapareces en
  el punto de partida con la vida llena y **5 s de protección** (una burbuja azul): ni
  caído ni protegido te elige ningún monstruo ni te cuentan sus golpes.
- **Cada uno publica y borra solo lo suyo**: un `object_state` o un `object_gone` que no
  viene de su creador se rechaza.

## Los demás jugadores

Cada uno manda su posición sellada (`player_pos`), hasta 5 veces por segundo al moverse y
cada 3 s quieto. Se dibujan con el mismo personaje, interpolando entre una posición y la
siguiente, y es lo que los monstruos miran para no aparecer cerca de nadie.

## Quién está en mi host

A un jugador se le sigue fuera de mi vista hasta que no tenga **ningún elemento relacionado**
conmigo (`isLinked`, `src/net/PeerLink.js`). Vínculo es cualquiera de estos:

- está en mi zona de visión (2× mi pantalla);
- un monstruo mío está en su zona (medida con mi pantalla: la suya no la sé);
- un monstruo suyo está en mi zona;
- un monstruo mío lo persigue porque le pegó (`provokedBy`, hasta que se calma).

Sin saber dónde está, cuenta como que sí. Sin vínculo sale de mi host: no se le manda lo mío
(monstruos, objetos), solo mi posición cada 5 s, para que los dos notemos cuándo volvemos a
estar cerca; al volver a entrar se le manda todo lo mío de una vez. Así también le llega todo
a quien se conecta tarde.

## Volver a donde estabas

La posición vive en el almacén del perfil (`@dotrino/store`), pero en el hilo
`local.gridgame.position`: se queda en este aparato y **no va a la bóveda** (store ≥ 0.14.0).
No merece respaldo, y cada escritura de un hilo normal es una sincronización. Se escribe
como mucho una vez por segundo al cambiar de casilla, y siempre al ocultarse la pestaña
(`src/save.js`). Si el almacén no abre, la pantalla lo dice.

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
