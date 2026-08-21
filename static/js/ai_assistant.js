"use strict";

/**
 * GeoParametric3D AI Engineering Assistant Controller
 * Connects UI input dock to Google Cloud Vertex AI REST gateways (/cad/api/assistant/chat, /api/assistant/chat, and /api/generate)
 * Executes returned CadQuery parametric operations or direct B-Rep mutations against the active CAD assembly.
 * Enforces authoritative B-Rep mathematical truth (Project: broadcasterfishmap, Location: global).
 */

import { CADState } from './state.js';
import { CADApi } from './api.js';
import { CADCommands } from './commands.js';
import { windowViewport } from './viewport.js';

export class AIAssistantController {
  constructor() {
    this.drawer = document.getElementById('assistant-drawer');
    this.btnToggle = document.getElementById('btn-toggle-assistant');
    this.btnSend = document.getElementById('btn-send-assistant');
    this.input = document.getElementById('assistant-input');
    this.messagesContainer = document.getElementById('assistant-messages');
    this.isProcessing = false;

    this.initListeners();
  }

  initListeners() {
    if (this.btnToggle && this.drawer) {
      this.btnToggle.addEventListener('click', () => {
        this.drawer.classList.toggle('collapsed');
        this.btnToggle.textContent = this.drawer.classList.contains('collapsed') ? '▲' : '▼';
      });
    }

    if (this.btnSend) {
      this.btnSend.addEventListener('click', () => this.sendCurrentPrompt());
    }

    if (this.input) {
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendCurrentPrompt();
        }
      });
    }
  }

  appendUserMessage(text) {
    if (!this.messagesContainer) return;
    const div = document.createElement('div');
    div.style.margin = '4px 0';
    div.innerHTML = `<strong>User:</strong> ${this.escapeHTML(text)}`;
    this.messagesContainer.appendChild(div);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  appendAssistantMessage(text, isError = false) {
    if (!this.messagesContainer) return;
    const div = document.createElement('div');
    div.style.margin = '4px 0';
    div.style.color = isError ? '#ef4444' : 'var(--accent-color, #38bdf8)';
    div.innerHTML = `<strong>Assistant:</strong> ${this.formatResponse(text)}`;
    this.messagesContainer.appendChild(div);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  escapeHTML(str) {
    const p = document.createElement('p');
    p.appendChild(document.createTextNode(str));
    return p.innerHTML;
  }

  formatResponse(text) {
    if (!text) return '';
    return this.escapeHTML(text).replace(/\n/g, '<br>');
  }

  async sendCurrentPrompt() {
    if (this.isProcessing || !this.input) return;
    const promptText = this.input.value.trim();
    if (!promptText) return;

    this.input.value = '';
    this.appendUserMessage(promptText);
    this.isProcessing = true;

    if (this.btnSend) this.btnSend.disabled = true;

    try {
      const activeSel = CADState.getSelectedObject();
      const selContext = activeSel ? {
        id: activeSel.manifest_id || activeSel.id,
        name: activeSel.name,
        material: activeSel.material,
        volume_cm3: activeSel.volume_cm3
      } : null;

      let res = null;
      // Connect to generation / assistant chat gateway
      try {
        res = await CADApi.requestJSON('/generate', {
          method: 'POST',
          body: JSON.stringify({
            prompt: promptText,
            message: promptText,
            target_selection: selContext
          })
        });
      } catch (e) {
        res = null;
      }

      if (!res || (!res.ok && !res.success)) {
        try {
          res = await CADApi.requestJSON('/assistant/chat', {
            method: 'POST',
            body: JSON.stringify({
              message: promptText,
              prompt: promptText,
              target_selection: selContext
            })
          });
        } catch (e) {
          res = await CADApi.sendAssistantPrompt(promptText);
        }
      }

      if (res && res.document) {
        CADState.setDocument(res.document);
        if (windowViewport) {
          windowViewport.geometryCacheDirty = true;
          windowViewport.render();
        }
      }

      if (res && res.action_intent && res.action_intent.action) {
        const intent = res.action_intent;
        if (intent.action.startsWith('feature_') || intent.action.startsWith('create_') || intent.action === 'transform') {
          await CADCommands.execute(intent.action, intent.parameters || intent.params || {});
        }
      }

      const reply = res?.message || res?.reply || res?.response || res?.code || 'Analyzed CAD assembly state.';
      this.appendAssistantMessage(reply, !res?.success && res?.ok === false);
    } catch (err) {
      this.appendAssistantMessage(`Error contacting Vertex AI Assistant: ${err.message}`, true);
    } finally {
      this.isProcessing = false;
      if (this.btnSend) this.btnSend.disabled = false;
    }
  }
}

export const aiAssistantController = new AIAssistantController();
window.aiAssistantController = aiAssistantController;
