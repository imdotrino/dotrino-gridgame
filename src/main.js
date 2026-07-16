import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { createBackNav } from '@dotrino/nav'
import './style.css'

// Navegación "volver" unificada del ecosistema (botón físico de Android / gesto
// de iOS / atrás del navegador → cierra modal; si no hay nada → dotrino.com).
// Se instala aquí, antes de montar, porque los `useBackLayer()` de App.vue
// corren en `setup`. El <dotrino-topbar> detecta este controlador y reusa el
// mismo (no instala otro); el chevron visible lo pone él.
createBackNav()

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
