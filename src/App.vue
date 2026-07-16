<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watchEffect } from 'vue'
import { messages, detectLang } from './i18n.js'
import { WorldView } from './render/WorldView.js'
import { ProceduralGround } from './world/ProceduralGround.js'
import { LocalStore } from './world/LocalStore.js'
import { PeerLink } from './net/PeerLink.js'
import { CombatHost } from './combat.js'
import { initIdentity, getMyPubkey, getIdentity, getReputation, repOf, repOfSync, warmRep } from './identity.js'
import { makeObject } from './objects/standard.js'
import { passableAt } from './world/collision.js'
import TilePicker from './render/TilePicker.vue'
import { createVaultProfileProvider } from '@dotrino/profile'
import '@dotrino/profile'
import '@dotrino/topbar' // barra superior estándar (§5): marca + volver + perfil + support
import { useBackLayer } from '@dotrino/nav/vue'

const showPicker = ref(false)

// --- Idioma (§9) ---
// La fuente de verdad es el <dotrino-topbar>: persiste 'dotrino.lang' y emite
// 'dotrino-lang' al cambiarlo. Arrancamos con su mismo criterio (detectLang) y
// desde ahí solo escuchamos: la app no tiene toggle ni clave propios.
const lang = ref(detectLang())
const t = computed(() => messages[lang.value])
function onLang (e) {
  const l = e.detail?.lang
  if (l === 'es' || l === 'en') lang.value = l
}
// Coherencia lang/og:locale (§7): el topbar ya lo hace al togglear; esto cubre
// la carga inicial (idioma guardado o del navegador).
watchEffect(() => { document.documentElement.lang = lang.value })

// --- Roster de jugadores conectados + perfil/reputación compartido ---
const peers = ref([])
const profilePk = ref(null)
let rosterTimer = null
let _profileProvider = null
function shortPk (pk) { const k = pk || ''; return k.length > 16 ? k.slice(0, 8) + '…' + k.slice(-4) : k }
async function ensureProfileProvider () {
  if (_profileProvider) return _profileProvider
  const reputation = getReputation()
  if (reputation) _profileProvider = createVaultProfileProvider({ identity: getIdentity(), reputation })
  return _profileProvider
}
function openPeer (pk) { if (pk && pk !== myPk) profilePk.value = pk }

// Volver unificado (@dotrino/nav): el botón físico / chevron
// cierra el selector de tiles o el perfil antes de salir hacia dotrino.com.
// (El modal "Mi perfil" lo abre y lo enlaza al "volver" el propio <dotrino-topbar>.)
useBackLayer(showPicker)
useBackLayer(profilePk, { onClose: () => { profilePk.value = null } })
function bindProfile (el) { if (!el) return; ensureProfileProvider().then((p) => { if (p) el.provider = p }) }
const profileTheme = {
  '--ccp-bg': '#1a1a1f', '--ccp-bg-2': '#23232b', '--ccp-bg-3': '#2a2a33', '--ccp-bg-4': '#3a3a45',
  '--ccp-border': '#3a3a45', '--ccp-text': '#eee', '--ccp-muted': '#9a9aa8',
  '--ccp-accent': '#C10C3E', '--ccp-accent-2': '#9a0a31', '--ccp-gold': '#f5b301', '--ccp-derived': '#d49a00',
  '--ccp-online': '#4ade80', '--ccp-affinity': '#a78bfa', '--ccp-input-bg': '#15151a', '--ccp-radius': '12px',
}

// --- Topbar estándar del ecosistema (§5/§6.1) ---
// El componente es DUEÑO del modal "Mi perfil": le pasamos los pilares que la
// app ya tiene (identity + reputation) y él deriva pubkey, nombre y avatar del
// perfil activo. Sin vault (modo standalone) quedan en null y el botón no abre
// nada, igual que antes con el FAB.
const topbarRef = ref(null)
const identityInst = ref(null)
const reputationInst = ref(null)
watchEffect(() => {
  const tb = topbarRef.value
  if (!tb) return
  tb.identity = identityInst.value
  tb.reputation = reputationInst.value
  tb.profileTheme = profileTheme
})

const canvasRef = ref(null)
// El estado se guarda como CLAVE, no como texto ya traducido: así cambiar de
// idioma retraduce también la línea de estado.
const statusKey = ref('booting')
const status = computed(() => t.value.status[statusKey.value])
let view = null
let store = null
let link = null
let combat = null
let myPk = null

const keys = new Set()
let moveRaf = null

function onKeyDown (e) {
  keys.add(e.key)
  // Acciones rápidas
  if (e.key === 'q') tryPlaceRock()
  if (e.key === 'e') trySummonSlime()
  if (e.key === 'f') tryAttackNearest()
  if (e.key === 't') showPicker.value = !showPicker.value
  if (e.key === 'Escape') showPicker.value = false
}
function onKeyUp (e) { keys.delete(e.key) }
function onResize () { view?.resize() }

function tryStep (dx, dy) {
  // Ejes por separado para permitir sliding contra obstáculos.
  const nx = view.camera.x + dx
  if (passableAt(nx, view.camera.y, view.ground, store).passable) view.camera.x = nx
  const ny = view.camera.y + dy
  if (passableAt(view.camera.x, ny, view.ground, store).passable) view.camera.y = ny
}

function tickMove () {
  if (!view) return
  const here = passableAt(view.camera.x, view.camera.y, view.ground, store)
  const base = 0.15
  const speed = base * (here.passable ? here.speed : 1)
  let dx = 0, dy = 0
  if (keys.has('ArrowUp') || keys.has('w')) dy -= speed
  if (keys.has('ArrowDown') || keys.has('s')) dy += speed
  if (keys.has('ArrowLeft') || keys.has('a')) dx -= speed
  if (keys.has('ArrowRight') || keys.has('d')) dx += speed
  if (dx || dy) tryStep(dx, dy)
  link?.setViewport({
    x0: Math.floor(view.camera.x) - 12,
    y0: Math.floor(view.camera.y) - 9,
    x1: Math.floor(view.camera.x) + 12,
    y1: Math.floor(view.camera.y) + 9
  })
  moveRaf = requestAnimationFrame(tickMove)
}

function myTilePos () {
  return { x: Math.round(view.camera.x), y: Math.round(view.camera.y) }
}

function tryPlaceRock () {
  if (!myPk) return
  const obj = makeObject('rock', { creator: myPk, ts: Date.now(), pos: myTilePos() })
  store.upsert(obj, { creatorOnline: true })
  link?.broadcastObjectState(obj)
}

function trySummonSlime () {
  if (!combat) return
  const myRep = repOfSync(myPk)
  combat.summon('slime', { x: myTilePos().x + 2, y: myTilePos().y }, myRep)
}

function tryAttackNearest () {
  if (!store) return
  const p = myTilePos()
  // Busca un enemigo adyacente.
  let target = null
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const objs = store.atTile(p.x + dx, p.y + dy)
      for (const o of objs) if (o.type === 'enemy') { target = o; break }
      if (target) break
    }
    if (target) break
  }
  if (!target) return
  const amount = Math.max(1, Math.floor(5 * repOfSync(myPk) + 1))
  if (target.creator === myPk) {
    combat.applyHit(target.id, amount)
  } else {
    link?.broadcastHit(target.id, target.creator, amount)
  }
}

onMounted(async () => {
  statusKey.value = 'identity'
  await initIdentity()
  myPk = getMyPubkey() || `local-${Math.random().toString(36).slice(2, 8)}`
  // Cablea el topbar con los pilares ya inicializados (perfil + avatar).
  identityInst.value = getIdentity()
  reputationInst.value = getReputation()

  store = new LocalStore({ myPeerId: myPk })

  view = new WorldView(canvasRef.value, {
    tileSize: 28,
    ground: new ProceduralGround(0xC10C3E),
    store,
    repOf: repOfSync,
    // El HUD se dibuja en canvas (fuera de Vue): le pasamos un getter para que
    // cada frame lea las etiquetas del idioma activo.
    hudLabels: () => t.value.hud
  })
  view.resize()
  view.start()
  moveRaf = requestAnimationFrame(tickMove)

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('resize', onResize)

  statusKey.value = 'connecting'
  try {
    link = new PeerLink({ store, repOfSync, url: import.meta.env.VITE_WS_URL || undefined })
    await link.start(myPk)
    combat = new CombatHost({ store, peerLink: link, myPubkey: myPk })
    statusKey.value = 'online'
  } catch (e) {
    console.warn('proxy connect failed', e)
    statusKey.value = 'offline'
  }

  // Pre-warm rep cache para peers que descubramos.
  setInterval(() => {
    if (!link) return
    warmRep([...link.peers.keys()])
  }, 10000)

  // Roster reactivo de jugadores conectados (link.peers no es reactivo).
  rosterTimer = setInterval(() => {
    peers.value = link ? [...link.peers.keys()].filter((pk) => pk && pk !== myPk) : []
  }, 2000)
})

onBeforeUnmount(() => {
  view?.stop()
  link?.stop()
  combat?.destroy()
  if (moveRaf) cancelAnimationFrame(moveRaf)
  if (rosterTimer) clearInterval(rosterTimer)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <canvas ref="canvasRef" class="world"></canvas>
  <!-- Barra superior estándar del ecosistema (§5): trae marca, "volver"
       (@dotrino/nav), botón de perfil (§6.1) y moneda de support (§6). Antes
       esto eran tres piezas sueltas colocadas a mano sobre el canvas. Se
       superpone al mundo (que sigue a pantalla completa) en vez de empujarlo.

       OJO con `:lang.attr` (no lo cambies a `lang="es"`): <dotrino-topbar> define
       un getter `lang` de solo lectura que tapa la propiedad nativa del elemento.
       Vue ve que `lang` existe en el elemento y lo asignaría como PROPIEDAD, la
       asignación se pierde en silencio y el componente cae a 'auto' (idioma del
       navegador). El modificador `.attr` fuerza setAttribute, que es lo que el
       componente lee.

       El toggle ES/EN del topbar es el ÚNICO selector de idioma de la app (§9):
       él persiste la preferencia y nos avisa por 'dotrino-lang'. -->
  <dotrino-topbar
    ref="topbarRef"
    brand="GridGame"
    icon="/icon.svg"
    brand-href="./"
    :lang.attr="lang"
    profile
    support-href="https://ko-fi.com/dotrino"
    support-repo="imdotrino/dotrino-gridgame"
    support-discord="https://discord.gg/D648uq7cth"
    @dotrino-lang="onLang"
  ></dotrino-topbar>
  <div class="hint">
    WASD {{ t.hint.move }} · <b>Q</b> {{ t.hint.rock }} · <b>E</b> {{ t.hint.summon }} ·
    <b>F</b> {{ t.hint.attack }} · <b>T</b> {{ t.hint.tiles }}
    <div class="status">{{ status }}</div>
  </div>
  <TilePicker v-if="showPicker" :lang="lang" @close="showPicker = false" />

  <div v-if="peers.length" class="roster">
    <div class="roster-title">{{ t.roster.title }}</div>
    <button v-for="pk in peers" :key="pk" class="roster-item" @click="openPeer(pk)" :title="t.roster.open">
      <span class="dot"></span>{{ shortPk(pk) }}
    </button>
  </div>

  <dotrino-profile
    v-if="profilePk"
    :ref="bindProfile"
    modal
    mode="edit"
    :lang.attr="lang"
    :style="profileTheme"
    :pubkey="profilePk"
    :name="shortPk(profilePk)"
    @cc-profile-close="profilePk = null"
  ></dotrino-profile>
</template>

<style scoped>
.world { position: fixed; inset: 0; width: 100vw; height: 100vh; }
/* El topbar se superpone al canvas (el mundo sigue ocupando toda la pantalla),
   con el mismo cristal oscuro que ya tenían las piezas flotantes y el carmesí
   de la marca como acento. El componente no es sticky por sí solo (§5). */
dotrino-topbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 10;
  --dotrino-topbar-bg: rgba(15, 23, 42, .55);
  --dotrino-topbar-border: rgba(255, 255, 255, .14);
  --dotrino-topbar-text: #e2e8f0;
  --dotrino-topbar-muted: #9a9aa8;
  --dotrino-topbar-accent: #C10C3E;
}
.hint {
  position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
  background: rgba(0,0,0,0.6); padding: 8px 14px; border-radius: 8px;
  font-size: 12px; pointer-events: none; text-align: center;
}
.status { margin-top: 4px; opacity: 0.7; font-size: 11px; }

.roster {
  /* Bajo el topbar (antes iba a top:12px, donde ahora está la barra). */
  position: fixed; top: calc(env(safe-area-inset-top) + 70px); right: 12px;
  background: rgba(0,0,0,0.6); border-radius: 8px; padding: 8px;
  display: flex; flex-direction: column; gap: 4px; min-width: 120px; max-width: 200px;
}
.roster-title { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; opacity: .6; margin-bottom: 2px; }
.roster-item {
  display: flex; align-items: center; gap: 6px;
  background: rgba(255,255,255,0.06); border: 0; border-radius: 6px;
  color: #eee; font-size: 12px; font-family: ui-monospace, monospace;
  padding: 5px 8px; cursor: pointer; text-align: left;
}
.roster-item:hover { background: rgba(255,255,255,0.14); }
.roster-item .dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; flex-shrink: 0; }
</style>
