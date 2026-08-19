"use strict";

import { CADState } from './state.js';
import { CADCommands } from './commands.js';
import { CADApi } from './api.js';
import { windowViewport } from './viewport.js';

document.addEventListener('DOMContentLoaded', async () => {
  console.log('CascadeCAD 12-Inch Workstation Bootstrapping...');

  try {
    const savedUuid = localStorage.getItem('cascadecad-active-uuid');
    if (savedUuid) {
      const res = await CADApi.loadProject(savedUuid);
      if (res?.success && res?.document) {
        CADState.setDocument(res.document);
        windowViewport.centerViewport();
      } else {
        await CADCommands.newDocument();
      }
    } else {
      const res = await CADApi.newProject();
      if (res?.document) {
        CADState.setDocument(res.document);
        windowViewport.centerViewport();
      }
    }

    const telemetry = await CADApi.fetchTelemetry();
    if (telemetry) {
      CADState.state.telemetry.fps = telemetry.fps ?? 60;
    }
  } catch (error) {
    console.error('[Bootstrap Error]', error);
  }
});
