"use strict";

/**
 * CascadeCAD Social Share, Screen Capture & MP4 Video Recording Engine
 * Supports instant snapshot downloads (clean viewport or with toolbars)
 * and up to 1-minute high-definition video recordings formatted for Bluesky, Instagram, Facebook.
 */

import { CADState } from './state.js';

export class ShareController {
  constructor() {
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.recordTimer = null;
    this.recordingStartTime = 0;
    this.maxRecordingDurationSec = 60;
    this.animationFrameId = null;
    this._toastTimeout = null;

    this.recBadge = null;
    this.recTimerDisplay = null;
    this.initRecBadge();
  }

  initRecBadge() {
    let badge = document.getElementById('viewport-rec-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'viewport-rec-badge';
      badge.className = 'rec-hud-badge hidden';
      badge.innerHTML = `
        <span class="rec-dot"></span>
        <span class="rec-text">REC</span>
        <span id="rec-timer-val" class="rec-timer">00:00 / 01:00</span>
        <button id="btn-rec-stop-hud" class="btn danger-btn mini-btn" title="Stop &amp; Download Recording">■ Stop</button>
      `;
      const viewportCont = document.getElementById('viewport-container');
      viewportCont?.appendChild(badge);
    }
    this.recBadge = badge;
    this.recTimerDisplay = document.getElementById('rec-timer-val');

    const btnStopHud = document.getElementById('btn-rec-stop-hud');
    btnStopHud?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.stopRecording();
    });
  }

  showToast(message, durationMs = 4000) {
    let toast = document.getElementById('cad-toast-notify');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'cad-toast-notify';
      toast.className = 'cad-toast-notification hidden';
      document.body.appendChild(toast);
    }
    toast.innerHTML = message;
    toast.classList.remove('hidden');
    toast.classList.add('show');

    if (this._toastTimeout) clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, durationMs);
  }

  getTimestampString() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  async takeSnapshot(includeToolbars = false) {
    const viewportCanvas = document.getElementById('viewport-overlay-canvas');
    if (!viewportCanvas) return;

    window.CADViewport?.render();

    const { width, height } = viewportCanvas;
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    const { theme = 'night' } = CADState.state.preferences || {};
    const isLight = theme === 'day' || theme === 'nord-hc-light';
    ctx.fillStyle = isLight ? '#ffffff' : (theme === 'gnome-hc' ? '#000000' : '#202124');
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(viewportCanvas, 0, 0);

    ctx.save();
    const brandY = height - 24;
    ctx.font = 'bold 16px Inter, system-ui, sans-serif';
    ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
    ctx.fillText('CascadeCAD 3D', 24, brandY);

    ctx.font = '12px JetBrains Mono, monospace';
    ctx.fillStyle = isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)';
    const docName = CADState.state.projectName || '12" Reference Model';
    const stamp = new Date().toLocaleDateString();
    ctx.fillText(`${docName} • ${stamp}`, 170, brandY);

    if (includeToolbars) {
      ctx.fillStyle = isLight ? 'rgba(240, 240, 240, 0.92)' : 'rgba(30, 32, 36, 0.92)';
      ctx.fillRect(0, 0, width, 50);
      ctx.strokeStyle = isLight ? '#dadce0' : '#3c4043';
      ctx.beginPath();
      ctx.moveTo(0, 50);
      ctx.lineTo(width, 50);
      ctx.stroke();

      ctx.font = 'bold 14px Inter, system-ui, sans-serif';
      ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
      ctx.fillText('⚡ CascadeCAD Workstation • Top Bar & Assembly Viewport', 20, 30);
    }

    ctx.restore();

    offscreen.toBlob((blob) => {
      if (!blob) return;
      const filename = `CascadeCAD_Snapshot_${this.getTimestampString()}.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.showToast(`📸 <strong>Snapshot Downloaded!</strong><br><span style="font-size:11px;">File saved as <code>${filename}</code>. Ready to post on Bluesky, Instagram or Facebook!</span>`);
      window.uiController?.logServerEvent(`[SNAPSHOT] Saved image ${filename}`);
    }, 'image/png');
  }

  startRecording() {
    if (this.isRecording) return;
    const canvas = document.getElementById('viewport-overlay-canvas');
    if (!canvas) return;

    this.recordedChunks = [];
    const stream = canvas.captureStream(60);

    const mimeTypes = [
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    const selectedMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) ?? 'video/webm';

    try {
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: selectedMime });
    } catch (e) {
      console.warn('Fallback basic MediaRecorder:', e);
      this.mediaRecorder = new MediaRecorder(stream);
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data?.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      this.handleRecordingComplete();
    };

    this.mediaRecorder.start(200);
    this.isRecording = true;
    this.recordingStartTime = Date.now();

    this.recBadge?.classList.remove('hidden');
    const btnToolbarRec = document.getElementById('btn-share-record');
    if (btnToolbarRec) {
      btnToolbarRec.classList.add('recording-active');
      btnToolbarRec.innerHTML = '⏹ Stop Rec';
    }

    if (this.recordTimer) clearInterval(this.recordTimer);
    this.recordTimer = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - this.recordingStartTime) / 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const timeStr = `00:${pad(elapsedSec)} / 01:00`;

      if (this.recTimerDisplay) {
        this.recTimerDisplay.textContent = timeStr;
      }

      window.CADViewport?.render();

      if (elapsedSec >= this.maxRecordingDurationSec) {
        this.stopRecording();
      }
    }, 250);

    this.showToast(`🔴 <strong>Recording Started!</strong> (Max 1 min .mp4)<br><span style="font-size:11px;">Interact with your 3D model. File will automatically download upon stop.</span>`);
    window.uiController?.logServerEvent('[RECORDING] Started 60-second video stream capture.');
  }

  stopRecording() {
    if (!this.isRecording) return;
    if (this.recordTimer) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }
    this.isRecording = false;

    this.recBadge?.classList.add('hidden');
    const btnToolbarRec = document.getElementById('btn-share-record');
    if (btnToolbarRec) {
      btnToolbarRec.classList.remove('recording-active');
      btnToolbarRec.innerHTML = '🎥 Record MP4';
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  handleRecordingComplete() {
    if (!this.recordedChunks.length) return;
    const mime = this.mediaRecorder.mimeType || 'video/mp4';
    const isMp4 = mime.includes('mp4');
    const ext = isMp4 ? 'mp4' : 'webm';
    const blob = new Blob(this.recordedChunks, { type: mime });

    const filename = `CascadeCAD_Video_${this.getTimestampString()}.${ext}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showToast(`🎬 <strong>Video Recording Saved!</strong><br><span style="font-size:11px;">Downloaded <code>${filename}</code>. Upload directly to Bluesky 🦋, Instagram 📸, or Facebook 📘!</span>`, 6000);
    window.uiController?.logServerEvent(`[RECORDING COMPLETE] Downloaded ${filename} (${(blob.size / (1024 * 1024)).toFixed(2)} MB)`);
  }

  openShareModal() {
    const modal = document.getElementById('share-social-modal');
    modal?.classList.remove('hidden');
  }
}

export const CADShare = new ShareController();
window.CADShare = CADShare;
