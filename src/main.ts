import { mount } from 'svelte'
import './app.css'
import './theme.css'
import App from './App.svelte'
import { zoomStore } from './lib/stores/zoomStore.svelte'

// Zoom guardado por equipo: se aplica antes de montar para evitar el salto de
// escala al abrir la app.
void zoomStore.init()

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
