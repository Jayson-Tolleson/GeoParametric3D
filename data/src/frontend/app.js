import { CADState } from './cad_state.js';
import { Map3DViewportRenderer } from './map3d_renderer.js';
import { UIController } from './ui_controller.js';

window.addEventListener('DOMContentLoaded', async () => {
  const map3dEl = document.querySelector('gmp-map-3d');
  const viewportRenderer = new Map3DViewportRenderer(map3dEl);
  const uiController = new UIController(viewportRenderer);

  // Fetch initial demo model
  try {
    const res = await fetch('/api/assembly/current');
    if (res.ok) {
      const assemblyData = await res.json();
      CADState.setAssembly(assemblyData);
    }
  } catch (err) {
    console.warn('Backend currently offline, loading local fallback demo.');
  }
});
