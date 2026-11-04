type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Aviso liviano de "cambiaron las tareas". Lo emite el asistente (o cualquier
 * otro consumidor) y `PanelControl` recarga la lista sin acoplarse al store.
 */
export const taskEvents = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (err) {
        console.warn('[taskEvents] listener falló', err);
      }
    }
  },
};
