import { CADState } from './state.js';
import { CADCommands } from './commands.js';
import { CADApi } from './api.js';
import { windowViewport } from './viewport.js';
import { WasmCADKernel } from './wasm_kernel.js';

export function applyTheme(themeName) {
  document.documentElement.setAttribute('data-theme', themeName);
  CADState.setPreferences({ theme: themeName });
  if (window.CADViewport) {
    window.CADViewport.render();
  }
}

export class UIController {
  constructor() {
    this.initSlidePanels();
    this.initInspector();
    this.initActionPanel();
    this.initAssistant();
    this.initPreferencesModal();
    this.initCncModal();
    this.initScriptModal();
    this.initImportHandler();
    
    const savedTheme = CADState.state.preferences.theme || 'night';
    applyTheme(savedTheme);

    CADState.subscribe(() => {
      this.renderAssemblyTree();
      this.renderInspector();
      this.renderTelemetry();
      this.syncActiveButtons();
      this.updateUnitDisplay();
    });
  }

  updateUnitDisplay() {
    const isImp = CADState.isImperial();
    const unitLabel = isImp ? 'in' : 'mm';
    
    const primSection = document.getElementById('label-primitives-section');
    if (primSection) {
      primSection.textContent = isImp ? '12" PRIMITIVES' : '300mm PRIMITIVES';
    }

    const lblPos = document.getElementById('lbl-prop-pos');
    if (lblPos) {
      lblPos.textContent = `Position (X, Y, Z - ${unitLabel})`;
    }
  }

  logServerEvent(msg) {
    const logs = document.getElementById('server-terminal-logs');
    if (!logs) return;
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const div = document.createElement('div');
    div.className = 'log-line';
    div.textContent = `[${timeStr}] ${msg}`;
    logs.appendChild(div);
    logs.scrollTop = logs.scrollHeight;
  }

  openPreferencesModal() {
    const modal = document.getElementById('preferences-modal');
    if (!modal) return;
    
    const themeSel = document.getElementById('pref-theme-selector');
    const unitSel = document.getElementById('pref-unit-selector');
    const chkGrid = document.getElementById('pref-toggle-grid');
    const chkAxes = document.getElementById('pref-toggle-axes');
    const chkCsnap = document.getElementById('pref-toggle-csnap');
    const chkInfinite = document.getElementById('pref-toggle-infinite');
    const sessionUuidInp = document.getElementById('pref-session-uuid');

    const prefs = CADState.state.preferences;
    if (themeSel) themeSel.value = prefs.theme || 'night';
    if (unitSel) unitSel.value = CADState.isImperial() ? 'imperial' : 'metric';
    if (chkGrid) chkGrid.checked = prefs.showGrid !== false;
    if (chkAxes) chkAxes.checked = prefs.showAxes !== false;
    if (chkCsnap) chkCsnap.checked = prefs.csnap !== false;
    if (chkInfinite) chkInfinite.checked = prefs.infiniteCanvas !== false;
    if (sessionUuidInp) sessionUuidInp.value = CADState.state.projectId || 'None';

    modal.classList.remove('hidden');
  }

  initPreferencesModal() {
    const modal = document.getElementById('preferences-modal');
    const btnClose = document.getElementById('btn-close-prefs');
    const btnSave = document.getElementById('btn-save-prefs');

    const close = () => {
      if (modal) modal.classList.add('hidden');
    };

    if (btnClose) btnClose.addEventListener('click', close);
    
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        const themeSel = document.getElementById('pref-theme-selector');
        const unitSel = document.getElementById('pref-unit-selector');
        const chkGrid = document.getElementById('pref-toggle-grid');
        const chkAxes = document.getElementById('pref-toggle-axes');
        const chkCsnap = document.getElementById('pref-toggle-csnap');
        const chkInfinite = document.getElementById('pref-toggle-infinite');

        const themeVal = themeSel ? themeSel.value : 'night';
        const unitVal = unitSel && unitSel.value === 'imperial' ? 'in' : 'mm';
        const gridVal = chkGrid ? chkGrid.checked : true;
        const axesVal = chkAxes ? chkAxes.checked : true;
        const csnapVal = chkCsnap ? chkCsnap.checked : true;
        const infiniteVal = chkInfinite ? chkInfinite.checked : true;

        CADState.setPreferences({
          theme: themeVal,
          units: unitVal,
          showGrid: gridVal,
          showAxes: axesVal,
          csnap: csnapVal,
          infiniteCanvas: infiniteVal
        });
        applyTheme(themeVal);
        this.logServerEvent(`[PREFERENCES] Saved (Theme: ${themeVal}, Units: ${unitVal}, Csnap: ${csnapVal})`);
        close();
      });
    }
  }

  initCncModal() {
    const modal = document.getElementById('cnc-modal');
    const btnClose = document.getElementById('btn-close-cnc');
    const btnDigest = document.getElementById('btn-digest-cnc');
    const btnDownload = document.getElementById('btn-download-gcode');
    const txtInput = document.getElementById('cnc-instructions-input');
    const txtPreview = document.getElementById('cnc-gcode-preview');
    const inpSpindle = document.getElementById('cnc-spindle');
    const inpFeedrate = document.getElementById('cnc-feedrate');

    if (btnClose && modal) {
      btnClose.addEventListener('click', () => modal.classList.add('hidden'));
    }

    if (btnDigest) {
      btnDigest.addEventListener('click', async () => {
        const sel = CADState.getSelectedObject();
        const tid = sel ? (sel.manifest_id || sel.id) : null;
        const res = await CADApi.buildInstructions(txtInput ? txtInput.value : '', {
          spindle: parseFloat(inpSpindle ? inpSpindle.value : 12000),
          feedrate: parseFloat(inpFeedrate ? inpFeedrate.value : 1200),
          target_id: tid
        });
        if (res && res.digest && txtPreview) {
          txtPreview.value = res.digest;
          this.logServerEvent(`[LINUXCNC] Digested instructions for target: ${res.target_object || 'scene'}`);
        }
      });
    }

    if (btnDownload && txtPreview) {
      btnDownload.addEventListener('click', () => {
        const text = txtPreview.value || '(No GCode)';
        const blob = new Blob([text], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'linuxcnc_output.gcode';
        a.click();
      });
    }
  }

  openCncModal() {
    const modal = document.getElementById('cnc-modal');
    if (!modal) return;
    const sel = CADState.getSelectedObject();
    const txtInput = document.getElementById('cnc-instructions-input');
    const txtPreview = document.getElementById('cnc-gcode-preview');
    if (txtInput && !txtInput.value) {
      txtInput.value = sel ? `Generate contour profile and pocket milling instructions for ${sel.name} (Material: ${sel.material})` : `Generate LinuxCNC standard 3-axis milling toolpath.`;
    }
    modal.classList.remove('hidden');
    const btnDigest = document.getElementById('btn-digest-cnc');
    if (btnDigest) btnDigest.click();
  }

  initScriptModal() {
    const modal = document.getElementById('scripting-modal');
    const btnClose = document.getElementById('btn-close-scripting');
    const btnRun = document.getElementById('btn-run-script');
    const txtEditor = document.getElementById('script-code-editor');

    if (btnClose && modal) {
      btnClose.addEventListener('click', () => modal.classList.add('hidden'));
    }

    if (btnRun && txtEditor) {
      btnRun.addEventListener('click', async () => {
        this.logServerEvent('[SCRIPT] Running CadQuery Python Kernel script...');
        const res = await CADApi.executeScript(txtEditor.value);
        if (res && res.ok) {
          if (res.document) CADState.setDocument(res.document);
          this.logServerEvent('[SCRIPT] CadQuery execution succeeded.');
          if (modal) modal.classList.add('hidden');
        } else {
          alert(`Script Error: ${res.error || 'Execution failed'}`);
        }
      });
    }
  }

  openScriptModal() {
    const modal = document.getElementById('scripting-modal');
    if (modal) modal.classList.remove('hidden');
  }

  initSlidePanels() {
    const setupBar = (panelId, retractBtnId, triangleIcons) => {
      const panel = document.getElementById(panelId);
      const btn = document.getElementById(retractBtnId);
      if (!panel || !btn) return;

      const triSpan = btn.querySelector('.triangle-icon');
      let closeTimeout = null;

      const updateState = () => {
        const isLocked = panel.dataset.locked === 'true';
        const isHovered = panel.dataset.hovered === 'true';
        const isOpen = isLocked || isHovered;

        if (isOpen) {
          panel.classList.add(isLocked ? 'locked-slid-out' : 'hover-slid-out');
        } else {
          panel.classList.remove('locked-slid-out', 'hover-slid-out');
        }

        if (triSpan) {
          triSpan.textContent = isOpen ? triangleIcons.open : triangleIcons.closed;
        }

        if (panelId === 'top-slide-container') {
          document.body.classList.toggle('top-bar-open', isOpen);
        }
        if (panelId === 'left-slide-container') {
          document.body.classList.toggle('left-bar-open', isOpen);
        }
        if (panelId === 'right-slide-container') {
          document.body.classList.toggle('right-bar-open', isOpen);
        }
      };

      const setHover = (val) => {
        if (closeTimeout) {
          clearTimeout(closeTimeout);
          closeTimeout = null;
        }
        if (val) {
          panel.dataset.hovered = 'true';
          updateState();
        } else {
          closeTimeout = setTimeout(() => {
            panel.dataset.hovered = 'false';
            updateState();
          }, 450);
        }
      };

      panel.addEventListener('mouseenter', () => setHover(true));
      panel.addEventListener('mouseleave', () => setHover(false));
      btn.addEventListener('mouseenter', () => setHover(true));
      btn.addEventListener('mouseleave', () => setHover(false));

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentlyLocked = panel.dataset.locked === 'true';
        panel.dataset.locked = currentlyLocked ? 'false' : 'true';
        updateState();
      });
    };

    setupBar('top-slide-container', 'btn-retract-top', { open: '▲', closed: '▼' });
    setupBar('left-slide-container', 'btn-retract-left', { open: '◄', closed: '►' });
    setupBar('right-slide-container', 'btn-retract-right', { open: '►', closed: '◄' });
  }

  initInspector() {}
  initActionPanel() {}
  initAssistant() {}
  initImportHandler() {}
  renderAssemblyTree() {}
  renderInspector() {}
  renderTelemetry() {}
  syncActiveButtons() {}
}


export const windowUI = new UIController();
