import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import '@dotrino/support'
import { createBackNav } from '@dotrino/nav'
import './style.css'

// Navegación "volver" unificada del ecosistema (chevron flotante + botón físico
// de Android / gesto de iOS / atrás del navegador → cierra modal; si no hay
// nada → dotrino.com).
createBackNav()

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
