<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const emit = defineEmits(['close'])
const canvasRef = ref(null)
const info = ref({ col: 0, row: 0 })
const ZOOM = 2 // 16 → 32px por tile en pantalla
const STRIDE = 17
const TILE = 16

let img = null

function draw () {
  const c = canvasRef.value
  if (!c || !img?.complete) return
  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = false
  c.width = img.naturalWidth * ZOOM
  c.height = img.naturalHeight * ZOOM
  ctx.drawImage(img, 0, 0, c.width, c.height)
  // Cuadrícula
  ctx.strokeStyle = 'rgba(255,0,255,0.25)'
  ctx.lineWidth = 1
  for (let x = 0; x < c.width; x += STRIDE * ZOOM) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke()
  }
  for (let y = 0; y < c.height; y += STRIDE * ZOOM) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke()
  }
}

function onMove (e) {
  const c = canvasRef.value
  const rect = c.getBoundingClientRect()
  const x = (e.clientX - rect.left) / ZOOM
  const y = (e.clientY - rect.top) / ZOOM
  info.value = { col: Math.floor(x / STRIDE), row: Math.floor(y / STRIDE) }
}

function onClick () {
  const t = `[${info.value.col}, ${info.value.row}]`
  navigator.clipboard?.writeText(t).catch(() => {})
}

onMounted(() => {
  img = new Image()
  img.onload = draw
  img.src = 'tiles.png'
})
onBeforeUnmount(() => {})
</script>

<template>
  <div class="picker" @click.self="emit('close')">
    <div class="bar">
      tile: <b>[{{ info.col }}, {{ info.row }}]</b> · click para copiar · ESC para cerrar
    </div>
    <div class="scroll">
      <canvas ref="canvasRef" @mousemove="onMove" @click="onClick"></canvas>
    </div>
  </div>
</template>

<style scoped>
.picker {
  position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 10;
  display: flex; flex-direction: column;
}
.bar {
  padding: 10px 16px; background: #222; color: #fff; font: 13px system-ui;
}
.scroll { flex: 1; overflow: auto; }
canvas { display: block; image-rendering: pixelated; cursor: crosshair; }
</style>
