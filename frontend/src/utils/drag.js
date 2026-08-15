import { ref } from 'vue';

// Drag & drop baseado em POINTER EVENTS (não usa o HTML5 Drag&Drop nativo,
// que é inconsistente entre navegadores). Funciona com mouse e touch.
//
// Uso:
//   const { payload, overKey, justDragged, begin } = usePointerDrag((item, key, zoneEl) => { ... });
//   card:  @pointerdown="begin(item, $event, 'rótulo do fantasma')"
//   zona:  :data-drop="chave"   (a chave é passada ao callback ao soltar)
//   highlight: :class="{ 'drop-target': overKey === chave }"
//   click:  @click="!justDragged && abrir(item)"
export function usePointerDrag(onDrop) {
  const payload = ref(null);      // item sendo arrastado (null quando parado)
  const overKey = ref(null);      // data-drop do alvo sob o cursor
  const justDragged = ref(false); // true por um instante após um arrasto (p/ suprimir o click)

  let start = null;   // { x, y, item, label }
  let ghost = null;
  let active = false;

  function begin(item, ev, label = '') {
    if (ev.button != null && ev.button !== 0) return; // só botão esquerdo
    start = { x: ev.clientX, y: ev.clientY, item, label };
    active = false;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  }

  function move(ev) {
    if (!start) return;
    if (!active) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      active = true;
      payload.value = start.item;
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = start.label;
      document.body.appendChild(ghost);
      document.body.style.userSelect = 'none';
    }
    ghost.style.left = `${ev.clientX + 12}px`;
    ghost.style.top = `${ev.clientY + 12}px`;
    overKey.value = zonaSob(ev)?.getAttribute('data-drop') ?? null;
  }

  function end(ev) {
    window.removeEventListener('pointermove', move);
    if (active && start) {
      const zone = zonaSob(ev);
      if (zone) onDrop(start.item, zone.getAttribute('data-drop'), zone);
      justDragged.value = true;
      setTimeout(() => { justDragged.value = false; }, 0);
    }
    if (ghost) { ghost.remove(); ghost = null; }
    document.body.style.userSelect = '';
    payload.value = null; overKey.value = null; start = null; active = false;
  }

  function zonaSob(ev) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    return el ? el.closest('[data-drop]') : null;
  }

  return { payload, overKey, justDragged, begin };
}
