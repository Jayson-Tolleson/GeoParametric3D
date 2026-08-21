"use strict";

/**
 * GeoParametric3D Assembly Tree Controller
 * Synchronizes hierarchical B-Rep selection with GeoAssembly, GeoPart, GeoSolid, GeoShell, and GeoFace UUIDs.
 * Implements bidirectional selection: Viewport -> Tree and Tree -> Viewport.
 */

import { CADState } from './state.js';
import { windowViewport } from './viewport.js';

export class AssemblyTreeController {
  constructor(containerId = 'assembly-tree') {
    this.containerId = containerId;
    this.treeElement = document.getElementById(containerId);

    CADState.subscribe(() => {
      this.render();
    });
  }

  render() {
    if (!this.treeElement) {
      this.treeElement = document.getElementById(this.containerId);
    }
    if (!this.treeElement) return;

    this.treeElement.innerHTML = '';
    const objects = CADState.state.objects || [];
    const assemblyTree = CADState.state.assemblyTree || [];
    const selectedIds = CADState.state.selectedIds || [];

    if (objects.length === 0) {
      this.treeElement.innerHTML = '<li class="placeholder-text">No parts in workspace</li>';
      return;
    }

    const renderNode = (node, container, depth = 0) => {
      if (depth > 6) return;
      const li = document.createElement('li');
      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      const objId = node.manifest_id || node.objectId || node.id;
      const matchedObj = objects.find(o => (o.manifest_id === objId || o.id === objId || o.object_id === objId));
      const isSel = objId ? selectedIds.includes(objId) : false;
      const isHidden = matchedObj && matchedObj.visible === false;

      const structureType = (node.structure_type || node.type || '').toUpperCase();
      let icon = '⚙️';
      if (hasChildren) icon = '📦';
      else if (structureType === 'SOLID') icon = '🧊';
      else if (structureType === 'SHELL') icon = '🛡️';
      else if (structureType === 'FACE') icon = '▱';
      else if (structureType === 'EDGE') icon = '╱';
      else if (structureType === 'VERTEX') icon = '•';

      li.className = `tree-item ${isSel ? 'selected' : ''} ${isHidden ? 'hidden-part' : ''}`;
      li.style.paddingLeft = `${Math.max(8, depth * 14 + 8)}px`;
      li.dataset.nodeId = objId;
      li.dataset.nodeType = structureType;

      const chevron = hasChildren
        ? `<span class="tree-toggle" style="cursor:pointer; user-select:none; margin-right:4px;">▶</span>`
        : `<span style="display:inline-block; width:12px;"></span>`;

      li.innerHTML = `
        ${chevron}
        <span class="tree-icon">${icon}</span>
        <span class="tree-name">${node.name || objId} ${isHidden ? '(Hidden)' : ''}</span>
      `;

      let subUl = null;
      if (hasChildren && depth < 6) {
        subUl = document.createElement('ul');
        subUl.className = 'tree-subgroup hidden';
        subUl.style.listStyle = 'none';
        node.children.forEach(child => renderNode(child, subUl, depth + 1));
      }

      const toggleBtn = li.querySelector('.tree-toggle');
      if (toggleBtn && subUl) {
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isCollapsed = subUl.classList.contains('hidden');
          if (isCollapsed) {
            subUl.classList.remove('hidden');
            toggleBtn.textContent = '▼';
          } else {
            subUl.classList.add('hidden');
            toggleBtn.textContent = '▶';
          }
        });
      }

      li.addEventListener('click', (e) => {
        e.stopPropagation();
        if (objId) {
          const isCtrl = e.ctrlKey || e.metaKey;
          const isShift = e.shiftKey;
          if (structureType === 'FACE') {
            CADState.setSelectedId(objId, isCtrl, isShift, {
              type: 'face',
              index: 0,
              info: {
                face_id: objId,
                surface_type: 'Plane',
                area_mm2: 0,
                normal: [0, 0, 1]
              }
            });
          } else {
            CADState.setSelectedId(objId, isCtrl, isShift, null);
          }
          if (windowViewport) {
            windowViewport.geometryCacheDirty = true;
            windowViewport.render();
          }
        }
      });

      container.appendChild(li);
      if (subUl) {
        container.appendChild(subUl);
      }
    };

    if (Array.isArray(assemblyTree) && assemblyTree.length > 0) {
      assemblyTree.forEach(rootNode => renderNode(rootNode, this.treeElement, 0));
    } else {
      objects.forEach(obj => {
        const id = obj.manifest_id || obj.id || obj.object_id;
        const isSel = selectedIds.includes(id);
        const isHidden = obj.visible === false;
        const li = document.createElement('li');
        li.className = `tree-item ${isSel ? 'selected' : ''} ${isHidden ? 'hidden-part' : ''}`;
        li.innerHTML = `<span class="tree-icon">⚙️</span><span class="tree-name">${obj.name}</span>`;
        li.addEventListener('click', (e) => {
          CADState.setSelectedId(id, e.ctrlKey || e.metaKey, e.shiftKey);
        });
        this.treeElement.appendChild(li);
      });
    }
  }
}

export const assemblyTreeController = new AssemblyTreeController();
window.assemblyTreeController = assemblyTreeController;
