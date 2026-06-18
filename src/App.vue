<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
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
import { useBackLayer } from '@dotrino/nav/vue'

const showPicker = ref(false)

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
// "Mi perfil": botón flotante a la izquierda de la moneda de soporte (que flota
// arriba a la derecha). Abre el mismo Web Component compartido en modo self.
const myProfilePk = ref(null)
function openMyProfile () { if (myPk && !myPk.startsWith('local-')) myProfilePk.value = myPk }

// Volver unificado (@dotrino/nav): el botón físico / chevron
// cierra el selector de tiles o el perfil antes de salir hacia dotrino.com.
useBackLayer(showPicker)
useBackLayer(profilePk, { onClose: () => { profilePk.value = null } })
useBackLayer(myProfilePk, { onClose: () => { myProfilePk.value = null } })
function bindProfile (el) { if (!el) return; ensureProfileProvider().then((p) => { if (p) el.provider = p }) }
const profileTheme = {
  '--ccp-bg': '#1a1a1f', '--ccp-bg-2': '#23232b', '--ccp-bg-3': '#2a2a33', '--ccp-bg-4': '#3a3a45',
  '--ccp-border': '#3a3a45', '--ccp-text': '#eee', '--ccp-muted': '#9a9aa8',
  '--ccp-accent': '#C10C3E', '--ccp-accent-2': '#9a0a31', '--ccp-gold': '#f5b301', '--ccp-derived': '#d49a00',
  '--ccp-online': '#4ade80', '--ccp-affinity': '#a78bfa', '--ccp-input-bg': '#15151a', '--ccp-radius': '12px',
}

const canvasRef = ref(null)
const status = ref('booting…')
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
  status.value = 'identity…'
  await initIdentity()
  myPk = getMyPubkey() || `local-${Math.random().toString(36).slice(2, 8)}`

  store = new LocalStore({ myPeerId: myPk })

  view = new WorldView(canvasRef.value, {
    tileSize: 28,
    ground: new ProceduralGround(0xC10C3E),
    store,
    repOf: repOfSync
  })
  view.resize()
  view.start()
  moveRaf = requestAnimationFrame(tickMove)

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('resize', onResize)

  status.value = 'connecting proxy…'
  try {
    link = new PeerLink({ store, repOfSync, url: import.meta.env.VITE_WS_URL || undefined })
    await link.start(myPk)
    combat = new CombatHost({ store, peerLink: link, myPubkey: myPk })
    status.value = `online · pk=${(myPk || '').slice(0, 10)}`
  } catch (e) {
    console.warn('proxy connect failed', e)
    status.value = `offline (no proxy) · pk=${(myPk || '').slice(0, 10)}`
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
  <!-- Sin header (canvas a pantalla completa): chevron de volver flotante
       arriba a la derecha. @dotrino/nav -->
  <dotrino-back floating style="left:auto;right:106px;top:14px;color:#e2e8f0;--cc-back-bg:rgba(15,23,42,.55);--cc-back-bg-hover:rgba(15,23,42,.8)"></dotrino-back>
  <!-- "Mi perfil" flotante, justo a la izquierda de la moneda de soporte. -->
  <button class="profile-fab" data-testid="my-profile" @click="openMyProfile" title="Mi perfil" aria-label="Mi perfil">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  </button>
  <div class="hint">
    WASD · <b>Q</b> roca · <b>E</b> summon · <b>F</b> atacar · <b>T</b> tile picker
    <div class="status">{{ status }}</div>
  </div>
  <TilePicker v-if="showPicker" @close="showPicker = false" />

  <div v-if="peers.length" class="roster">
    <div class="roster-title">Jugadores</div>
    <button v-for="pk in peers" :key="pk" class="roster-item" @click="openPeer(pk)" title="Ver perfil / reputación">
      <span class="dot"></span>{{ shortPk(pk) }}
    </button>
  </div>

  <dotrino-profile
    v-if="profilePk"
    :ref="bindProfile"
    modal
    mode="edit"
    :style="profileTheme"
    :pubkey="profilePk"
    :name="shortPk(profilePk)"
    @cc-profile-close="profilePk = null"
  ></dotrino-profile>

  <dotrino-profile
    v-if="myProfilePk"
    :ref="bindProfile"
    modal
    mode="self"
    :style="profileTheme"
    :pubkey="myProfilePk"
    :name="shortPk(myProfilePk)"
    @cc-profile-close="myProfilePk = null"
  ></dotrino-profile>
</template>

<style scoped>
.world { position: fixed; inset: 0; width: 100vw; height: 100vh; }
/* "Mi perfil" flotante: a la izquierda de la moneda (right:14px) y a la derecha
   del chevron de volver (right:106px). */
.profile-fab {
  position: fixed; top: 14px; right: 60px; z-index: 10;
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; padding: 0;
  color: #e2e8f0; background: rgba(15,23,42,.55);
  border: 1px solid rgba(255,255,255,.14); border-radius: 50%; cursor: pointer;
  transition: background .15s;
}
.profile-fab:hover { background: rgba(15,23,42,.8); }
.profile-fab svg { width: 20px; height: 20px; display: block; }
@media (max-width: 480px) { .profile-fab { width: 32px; height: 32px; right: 54px; } }
.hint {
  position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
  background: rgba(0,0,0,0.6); padding: 8px 14px; border-radius: 8px;
  font-size: 12px; pointer-events: none; text-align: center;
}
.status { margin-top: 4px; opacity: 0.7; font-size: 11px; }

.roster {
  position: fixed; top: 12px; right: 12px;
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
