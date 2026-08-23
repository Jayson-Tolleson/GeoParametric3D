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
    const sessionUuidInp = document.getElementById('pref-session-uuid');

    const prefs = CADState.state.preferences;
    if (themeSel) themeSel.value = prefs.theme || 'night';
    if (unitSel) unitSel.value = CADState.isImperial() ? 'imperial' : 'metric';
    if (chkGrid) chkGrid.checked = prefs.showGrid !== false;
    if (chkAxes) chkAxes.checked = prefs.showAxes !== false;
    if (chkCsnap) chkCsnap.checked = prefs.csnap !== false;
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

        const themeVal = themeSel ? themeSel.value : 'night';
        const unitVal = unitSel && unitSel.value === 'imperial' ? 'in' : 'mm';
        const gridVal = chkGrid ? chkGrid.checked : true;
        const axesVal = chkAxes ? chkAxes.checked : true;
        const csnapVal = chkCsnap ? chkCsnap.checked : true;

        CADState.setPreferences({
          theme: themeVal,
          units: unitVal,
          showGrid: gridVal,
          showAxes: axesVal,
          csnap: csnapVal
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
        e.preventDefault();
        const currentLocked = panel.dataset.locked === 'true';
        panel.dataset.locked = (!currentLocked).toString();
        updateState();
      });

      updateState();
    };

    setupBar('top-slide-container', 'btn-top-retract', { open: '\u25b2', closed: '\u25bc' });
    setupBar('left-slide-container', 'btn-left-retract', { open: '\u25c0', closed: '\u25b6' });
    setupBar('right-slide-container', 'btn-right-retract', { open: '\u25b6', closed: '\u25c0' });
  }

  initImportHandler() {
    const fileInput = document.getElementById('import-file-input');
    if (!fileInput) return;

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      this.logServerEvent(`[IMPORT] Parsing 3D universal bytes hierarchy: ${file.name}`);

      try {
        let res = null;
        if (WasmCADKernel.isStepOrBRep(file.name)) {
          const arrayBuffer = await file.arrayBuffer();
          try {
            res = await WasmCADKernel.parseStepArrayBuffer(arrayBuffer, file.name);
          } catch (wasmErr) {
            console.warn('[UI] WASM direct parse fallback:', wasmErr);
            res = null;
          }
        }

        if (!res || !res.ok) {
          res = await CADApi.importBytes(file);
        }

        if (res && res.ok && res.document) {
          CADState.setDocument(res.document);
          windowViewport.centerViewport();
          this.logServerEvent(`[IMPORT SUCCESS] Loaded 3D geometry hierarchy with ${res.document.objects ? res.document.objects.length : 1} body/bodies.`);
        } else {
          const err = (res && res.error) || 'Import failed';
          this.logServerEvent(`[IMPORT ERROR] ${err}`);
          alert(`Import Error: ${err}`);
        }
      } catch (err) {
        this.logServerEvent(`[IMPORT EXCEPTION] ${err.message}`);
        alert(`Import Error: ${err.message}`);
      }
      fileInput.value = '';
    });
  }

  initActionPanel() {
    const panelBox = document.getElementById('action-panel-box');
    const btnClose = document.getElementById('btn-close-action-panel');
    const btnCancel = document.getElementById('btn-cancel-action-panel');
    const btnCommit = document.getElementById('btn-commit-action-panel');

    const dismiss = () => {
      if (panelBox) panelBox.classList.add('hidden');
      CADState.setActiveAction(null);
      CADState.setActiveTool(null);
      CADState.setActiveTransformTool(null);
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active-tool-btn'));
      if (window.CADViewport) {
        window.CADViewport.cancelBoxSelection();
        window.CADViewport.render();
      }
    };

    if (btnClose) btnClose.addEventListener('click', dismiss);
    if (btnCancel) btnCancel.addEventListener('click', dismiss);

    if (btnCommit) {
      btnCommit.addEventListener('click', async () => {
        const action = CADState.state.activeAction;
        if (!action) return;
        
        const params = {};
        document.querySelectorAll('.action-dynamic-input').forEach(inp => {
          const key = inp.dataset.key;
          const isLength = inp.dataset.isLength === 'true';
          if (inp.type === 'checkbox') {
            params[key] = inp.checked;
            return;
          }
          let val = isNaN(Number(inp.value)) ? inp.value : parseFloat(inp.value);
          if (isLength && typeof val === 'number') {
            val = CADState.fromUserLength(val);
          }
          params[key] = val;
        });

        const sel = CADState.getSelectedObject();
        const selectedId = sel ? (sel.manifest_id || sel.id || sel.object_id) : null;
        if (['extrude','cross-sections','hole','fillet','chamfer','revolve'].includes(action.type)) {
          await CADCommands.execute(`feature_${action.type.replaceAll('-', '_')}`, { ...params, target_id: selectedId });
        } else if (action.type === 'transform_move' || action.type === 'transform_rotate' || action.type === 'transform_scale' || action.type === 'transform_duplicate') {
          await CADCommands.transform(action.transformAction, { ...params, target_id: selectedId });
        } else if (action.type === 'align') {
          await CADCommands.execute('align_object', { ...params, id: selectedId });
        } else if (action.type === 'create_primitive') {
          await CADCommands.createPrimitive(action.primitiveType, params);
        } else if (action.type === 'draft') {
          windowViewport.commitDraft();
        } else {
          await CADCommands.execute(`feature_${action.type.replaceAll('-', '_')}`, { ...params, target_id: selectedId });
        }
        dismiss();
      });
    }
  }

  openActionPanel(actionType, title, configFields, extraState = {}) {
    const panelBox = document.getElementById('action-panel-box');
    const panelTitle = document.getElementById('action-panel-title');
    const panelBody = document.getElementById('action-panel-body');
    if (!panelBox || !panelBody) return;

    CADState.setActiveAction({ type: actionType, fields: configFields, ...extraState });
    panelTitle.textContent = title;
    panelBody.innerHTML = '';

    const unitLabel = CADState.isImperial() ? 'in' : 'mm';

    configFields.forEach(f => {
      const row = document.createElement('div');
      row.className = 'form-group';
      
      let labelText = f.label;
      if (f.isLength) {
        labelText = `${f.baseLabel || f.label} (${unitLabel})`;
      }
      
      if (f.type === 'checkbox') {
        row.innerHTML = `
          <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; cursor: pointer;">
            <input type="checkbox" class="action-dynamic-input" data-key="${f.key}" ${f.default ? 'checked' : ''}>
            ${f.label}
          </label>
        `;
      } else if (f.type === 'select') {
        row.innerHTML = `<label>${labelText}</label>`;
        const sel = document.createElement('select');
        sel.className = 'input-select action-dynamic-input';
        sel.dataset.key = f.key;
        f.options.forEach(opt => {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.text;
          if (opt.value === f.default) o.selected = true;
          sel.appendChild(o);
        });
        row.appendChild(sel);
      } else {
        row.innerHTML = `<label>${labelText}</label>`;
        const inp = document.createElement('input');
        inp.type = f.type || 'number';
        inp.className = 'input-text action-dynamic-input';
        inp.dataset.key = f.key;
        inp.dataset.isLength = f.isLength ? 'true' : 'false';
        
        let defVal = f.default !== undefined ? f.default : 1.0;
        if (f.isLength && typeof defVal === 'number') {
          defVal = CADState.toUserLength(defVal);
        }
        inp.value = typeof defVal === 'number' ? Number(defVal.toFixed(3)) : defVal;
        if (f.step) inp.step = f.step;
        row.appendChild(inp);
      }
      panelBody.appendChild(row);
    });

    panelBox.classList.remove('hidden');
  }

  initInspector() {
    const propName = document.getElementById('prop-name');
    const propMaterial = document.getElementById('prop-material');
    const propPosX = document.getElementById('prop-pos-x');
    const propPosY = document.getElementById('prop-pos-y');
    const propPosZ = document.getElementById('prop-pos-z');
    const propRotX = document.getElementById('prop-rot-x');
    const propRotY = document.getElementById('prop-rot-y');
    const propRotZ = document.getElementById('prop-rot-z');
    const propScaleX = document.getElementById('prop-scale-x');
    const propScaleY = document.getElementById('prop-scale-y');
    const propScaleZ = document.getElementById('prop-scale-z');
    const propColor = document.getElementById('prop-color');
    const propColorHex = document.getElementById('prop-color-hex');
    const propOpacity = document.getElementById('prop-opacity');
    const opacityVal = document.getElementById('opacity-val');
    const btnDelete = document.getElementById('btn-delete-selected');
    const btnHide = document.getElementById('btn-hide-selected');
    const btnApplyParameters = document.getElementById('btn-apply-parameters');

    if (propName) {
      propName.addEventListener('change', () => {
        const sel = CADState.getSelectedObject();
        if (sel) sel.name = propName.value;
        CADCommands.setProperty('name', propName.value);
      });
    }
    if (propMaterial) {
      propMaterial.addEventListener('change', () => {
        const sel = CADState.getSelectedObject();
        if (sel) sel.material = propMaterial.value;
        CADCommands.setProperty('material', propMaterial.value);
      });
    }

    const updatePos = () => {
      const xUser = parseFloat(propPosX ? propPosX.value : 0) || 0;
      const yUser = parseFloat(propPosY ? propPosY.value : 0) || 0;
      const zUser = parseFloat(propPosZ ? propPosZ.value : 0) || 0;
      const x = CADState.fromUserLength(xUser);
      const y = CADState.fromUserLength(yUser);
      const z = CADState.fromUserLength(zUser);
      const sel = CADState.getSelectedObject();
      if (sel) sel.position = [x, y, z];
      CADCommands.setProperty('position', [x, y, z]);
    };
    if (propPosX) propPosX.addEventListener('change', updatePos);
    if (propPosY) propPosY.addEventListener('change', updatePos);
    if (propPosZ) propPosZ.addEventListener('change', updatePos);

    const updateRot = () => {
      const x = parseFloat(propRotX ? propRotX.value : 0) || 0;
      const y = parseFloat(propRotY ? propRotY.value : 0) || 0;
      const z = parseFloat(propRotZ ? propRotZ.value : 0) || 0;
      const sel = CADState.getSelectedObject();
      if (sel) sel.rotation = [x, y, z];
      CADCommands.setProperty('rotation', [x, y, z]);
    };
    if (propRotX) propRotX.addEventListener('change', updateRot);
    if (propRotY) propRotY.addEventListener('change', updateRot);
    if (propRotZ) propRotZ.addEventListener('change', updateRot);

    const updateScale = () => {
      const x = parseFloat(propScaleX ? propScaleX.value : 1.0) || 1.0;
      const y = parseFloat(propScaleY ? propScaleY.value : 1.0) || 1.0;
      const z = parseFloat(propScaleZ ? propScaleZ.value : 1.0) || 1.0;
      const sel = CADState.getSelectedObject();
      if (sel) sel.scale = [x, y, z];
      CADCommands.setProperty('scale', [x, y, z]);
    };
    if (propScaleX) propScaleX.addEventListener('change', updateScale);
    if (propScaleY) propScaleY.addEventListener('change', updateScale);
    if (propScaleZ) propScaleZ.addEventListener('change', updateScale);

    if (propColor) {
      propColor.addEventListener('input', () => {
        if (propColorHex) propColorHex.textContent = propColor.value;
        const sel = CADState.getSelectedObject();
        if (sel) sel.color = propColor.value;
        if (window.CADViewport) {
          window.CADViewport.geometryCacheDirty = true;
          window.CADViewport.syncNativeDOM();
          window.CADViewport.render();
        }
      });
      propColor.addEventListener('change', () => {
        CADCommands.setProperty('color', propColor.value);
      });
    }

    if (propOpacity) {
      propOpacity.addEventListener('input', () => {
        const val = parseFloat(propOpacity.value) || 1.0;
        if (opacityVal) opacityVal.textContent = Math.round(val * 100);
        const sel = CADState.getSelectedObject();
        if (sel) sel.opacity = val;
        if (window.CADViewport) {
          window.CADViewport.geometryCacheDirty = true;
          window.CADViewport.syncNativeDOM();
          window.CADViewport.render();
        }
      });
      propOpacity.addEventListener('change', () => {
        const val = parseFloat(propOpacity.value) || 1.0;
        CADCommands.setProperty('opacity', val);
      });
    }

    if (btnApplyParameters) {
      btnApplyParameters.addEventListener('click', async () => {
        const sel = CADState.getSelectedObject();
        if (!sel) return;
        const container = document.getElementById('prop-parameters');
        if (!container) return;
        const parameters = {};
        container.querySelectorAll('[data-param-key]').forEach(inp => {
          const key = inp.dataset.paramKey;
          if (inp.type === 'checkbox') parameters[key] = inp.checked;
          else {
            const n = Number(inp.value);
            parameters[key] = Number.isFinite(n) && inp.dataset.paramNumeric === 'true' ? n : inp.value;
            if (inp.dataset.paramLength === 'true' && Number.isFinite(n)) {
              parameters[key] = CADState.fromUserLength(n);
            }
          }
        });
        await CADCommands.setProperty('parameters', parameters);
      });
    }

    if (btnDelete) btnDelete.addEventListener('click', () => CADCommands.deleteSelected());
    if (btnHide) btnHide.addEventListener('click', () => CADCommands.toggleSelectedVisibility());
  }

  syncActiveButtons() {
    const activeTool = CADState.state.activeTool;
    document.querySelectorAll('.draft-tool-btn').forEach(btn => {
      btn.classList.toggle('active-tool-btn', btn.dataset.tool === activeTool);
    });
    const selMode = CADState.state.selectionMode;
    document.querySelectorAll('.sel-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === selMode);
    });
    const btnCsnap = document.getElementById('btn-toggle-csnap');
    if (btnCsnap) {
      btnCsnap.classList.toggle('active-snap-btn', CADState.state.preferences.csnap !== false);
    }
  }

  renderAssemblyTree() {
    const tree = document.getElementById('assembly-tree');
    if (!tree) return;
    tree.innerHTML = '';

    const objects = CADState.state.objects;
    const selectedIds = CADState.state.selectedIds;
    const assemblyTree = CADState.state.assemblyTree;

    if (objects.length === 0) {
      tree.innerHTML = '<li class="placeholder-text">No parts in workspace</li>';
      return;
    }

    const renderTreeNode = (node, container, depth = 0) => {
      if (depth > 4) return;
      const li = document.createElement('li');
      const isGroup = node.children && node.children.length > 0;
      const objId = node.manifest_id || node.objectId || node.id;
      const matchedObj = objects.find(o => (o.manifest_id === objId || o.id === objId || o.object_id === objId));
      const isSel = objId ? selectedIds.includes(objId) : false;
      const isHidden = matchedObj && matchedObj.visible === false;

      li.className = `tree-item ${isSel ? 'selected' : ''} ${isHidden ? 'hidden-part' : ''}`;
      li.style.paddingLeft = `${Math.max(8, depth * 14 + 8)}px`;
      li.innerHTML = `
        <span class="tree-icon">${isGroup ? '\ud83d\udcc1' : '\u2699\ufe0f'}</span>
        <span class="tree-name">${node.name || 'Component'} ${isHidden ? '(Hidden)' : ''}</span>
      `;

      li.addEventListener('click', (e) => {
        e.stopPropagation();
        if (objId) {
          CADState.setSelectedId(objId, e.ctrlKey || e.metaKey, e.shiftKey);
        }
      });

      container.appendChild(li);

      if (isGroup && depth < 4) {
        const subUl = document.createElement('ul');
        subUl.className = 'tree-subgroup';
        subUl.style.listStyle = 'none';
        node.children.forEach(child => renderTreeNode(child, subUl, depth + 1));
        container.appendChild(subUl);
      }
    };

    if (Array.isArray(assemblyTree) && assemblyTree.length > 0) {
      assemblyTree.forEach(rootNode => renderTreeNode(rootNode, tree, 0));
    } else {
      objects.forEach(obj => {
        const id = obj.manifest_id || obj.id || obj.object_id;
        const isSel = selectedIds.includes(id);
        const isHidden = obj.visible === false;
        const li = document.createElement('li');
        li.className = `tree-item ${isSel ? 'selected' : ''} ${isHidden ? 'hidden-part' : ''}`;
        li.innerHTML = `<span class="tree-icon">\u2699\ufe0f</span><span class="tree-name">${obj.name}</span>`;
        li.addEventListener('click', (e) => {
          CADState.setSelectedId(id, e.ctrlKey || e.metaKey, e.shiftKey);
        });
        tree.appendChild(li);
      });
    }
  }

  renderInspector() {
    const notice = document.getElementById('no-selection-notice');
    const form = document.getElementById('inspector-form');
    const sel = CADState.getSelectedObject();
    const subElemBadge = document.getElementById('sub-element-selection-badge');
    const subElemType = document.getElementById('sub-elem-type');

    if (subElemBadge) {
      if (CADState.state.selectedVertexIndex !== null) {
        subElemBadge.classList.remove('hidden');
        subElemType.textContent = `Vertex #${CADState.state.selectedVertexIndex}`;
      } else if (CADState.state.selectedEdgeIndex !== null) {
        subElemBadge.classList.remove('hidden');
        subElemType.textContent = `Continuous Edge #${CADState.state.selectedEdgeIndex}`;
      } else if (CADState.state.selectedFaceIndex !== null) {
        subElemBadge.classList.remove('hidden');
        if (CADState.state.selectedFaceInfo) {
          const selInfo = CADState.state.selectedFaceInfo;
          subElemType.textContent = `Face: ${selInfo.face_id} | Type: ${selInfo.surface_type} | Area: ${selInfo.area_mm2.toFixed(2)} mm\u00b2 | Normal: [${selInfo.normal.map(n => n.toFixed(2)).join(', ')}]`;
        } else {
          subElemType.textContent = `Planar Face #${CADState.state.selectedFaceIndex}`;
        }
      } else {
        subElemBadge.classList.add('hidden');
      }
    }

    if (!sel) {
      if (notice) notice.classList.remove('hidden');
      if (form) form.classList.add('hidden');
      return;
    }

    if (notice) notice.classList.add('hidden');
    if (form) form.classList.remove('hidden');

    const propName = document.getElementById('prop-name');
    const propMaterial = document.getElementById('prop-material');
    const propPosX = document.getElementById('prop-pos-x');
    const propPosY = document.getElementById('prop-pos-y');
    const propPosZ = document.getElementById('prop-pos-z');
    const propRotX = document.getElementById('prop-rot-x');
    const propRotY = document.getElementById('prop-rot-y');
    const propRotZ = document.getElementById('prop-rot-z');
    const propScaleX = document.getElementById('prop-scale-x');
    const propScaleY = document.getElementById('prop-scale-y');
    const propScaleZ = document.getElementById('prop-scale-z');
    const propColor = document.getElementById('prop-color');
    const propColorHex = document.getElementById('prop-color-hex');
    const propOpacity = document.getElementById('prop-opacity');
    const opacityVal = document.getElementById('opacity-val');

    if (propName) propName.value = sel.name || '';
    if (propMaterial) propMaterial.value = sel.material || 'Steel';
    
    const pos = sel.position || [0, 0, 0];
    const posXUser = CADState.toUserLength(pos[0]);
    const posYUser = CADState.toUserLength(pos[1]);
    const posZUser = CADState.toUserLength(pos[2]);
    if (propPosX) propPosX.value = Number(posXUser.toFixed(2));
    if (propPosY) propPosY.value = Number(posYUser.toFixed(2));
    if (propPosZ) propPosZ.value = Number(posZUser.toFixed(2));

    const rot = sel.rotation || [0, 0, 0];
    if (propRotX) propRotX.value = rot[0];
    if (propRotY) propRotY.value = rot[1];
    if (propRotZ) propRotZ.value = rot[2];

    const scl = sel.scale || [1.0, 1.0, 1.0];
    if (propScaleX) propScaleX.value = Number(scl[0]).toFixed(4);
    if (propScaleY) propScaleY.value = Number(scl[1]).toFixed(4);
    if (propScaleZ) propScaleZ.value = Number(scl[2]).toFixed(4);

    if (propColor) propColor.value = sel.color || '#38bdf8';
    if (propColorHex) propColorHex.textContent = sel.color || '#38bdf8';
    const op = sel.opacity !== undefined ? sel.opacity : 1.0;
    if (propOpacity) propOpacity.value = op;
    if (opacityVal) opacityVal.textContent = Math.round(op * 100);

    const paramHost = document.getElementById('prop-parameters');
    if (paramHost) {
      paramHost.innerHTML = '';
      const unitLabel = CADState.isImperial() ? 'in' : 'mm';
      const lengthKeys = new Set([
        'width','height','depth','radius','major_radius','minor_radius',
        'inner_radius','radius_x','radius_y','shell_thickness','distance',
        'diameter','spacing','thickness'
      ]);
      const params = sel.parameters || {};
      Object.entries(params).forEach(([key, raw]) => {
        if (key.startsWith('_')) return;
        const row = document.createElement('div');
        row.className = 'form-group';
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const isBool = typeof raw === 'boolean';
        const isNum = typeof raw === 'number';
        const isLength = isNum && lengthKeys.has(key);
        row.innerHTML = `<label>${label}${isLength ? ` (${unitLabel})` : ''}</label>`;
        const input = document.createElement('input');
        input.className = 'input-text';
        input.dataset.paramKey = key;
        input.dataset.paramNumeric = isNum ? 'true' : 'false';
        input.dataset.paramLength = isLength ? 'true' : 'false';
        if (isBool) {
          input.type = 'checkbox';
          input.checked = raw;
        } else if (isNum) {
          input.type = 'number';
          input.step = 'any';
          const v = isLength ? CADState.toUserLength(raw) : raw;
          input.value = Number(v).toFixed(4).replace(/0+$/,'').replace(/\.$/,'');
        } else {
          input.type = 'text';
          input.value = raw ?? '';
        }
        row.appendChild(input);
        paramHost.appendChild(row);
      });
      if (Object.keys(params).filter(k => !k.startsWith('_')).length === 0) {
        paramHost.innerHTML = '<div class="placeholder-text">No parametric dimensions exposed for this imported body.</div>';
      }
    }
  }

  renderTelemetry() {
    const telemObj = document.getElementById('telem-objects');
    const telemVert = document.getElementById('telem-vertices');
    const telemFps = document.getElementById('telem-fps');

    if (telemObj) telemObj.textContent = CADState.state.telemetry.objects;
    if (telemVert) telemVert.textContent = CADState.state.telemetry.vertices;
    if (telemFps) telemFps.textContent = CADState.state.telemetry.fps;
  }

  initAssistant() {
    const btnSend = document.getElementById('btn-send-assistant');
    const input = document.getElementById('assistant-input');
    const btnToggle = document.getElementById('btn-toggle-assistant');
    const drawer = document.getElementById('assistant-drawer');

    if (btnToggle && drawer) {
      btnToggle.addEventListener('click', () => {
        drawer.classList.toggle('collapsed');
        btnToggle.textContent = drawer.classList.contains('collapsed') ? '\u25b2' : '\u25bc';
    });
  }

  renderTelemetry() {
    const telemObj = document.getElementById('telem-objects');
    const telemVert = document.getElementById('telem-vertices');
    const telemFps = document.getElementById('telem-fps');

    if (telemObj) telemObj.textContent = CADState.state.objects.length;
    if (telemVert) {
      const vertCount = CADState.state.objects.reduce((acc, obj) => {
        return acc + (obj.vertices ? obj.vertices.length / 3 : 0);
      }, 0);
      telemVert.textContent = vertCount;
    }
    if (telemFps && window.CADViewport) {
      telemFps.textContent = window.CADViewport.fps || 60;
    }
  }

  initAssistant() {
    const btnSend = document.getElementById('btn-send-assistant');
    const inputMsg = document.getElementById('assistant-input-msg');
    const chatLog = document.getElementById('assistant-chat-log');

    if (!btnSend || !inputMsg) return;

    const sendMessage = async () => {
      const msg = inputMsg.value.trim();
      if (!msg) return;

      if (chatLog) {
        chatLog.innerHTML += `<div class="chat-msg user-msg"><strong>You:</strong> ${msg}</div>`;
        chatLog.scrollTop = chatLog.scrollHeight;
      }
      inputMsg.value = '';

      const res = await CADApi.queryAssistant(msg, CADState.state);
      if (res && res.response && chatLog) {
        const replyText = res.message || res.reply || res.response || 'Command executed.';
        chatLog.innerHTML += `<div style="margin: 4px 0; color: var(--accent-color);">${replyText.replace(/\n/g, '<br>')}</div>`;
        chatLog.scrollTop = chatLog.scrollHeight;
      }
    };

    btnSend.addEventListener('click', sendMessage);
    inputMsg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  }
}

  }
export const windowUI = new UIController();
