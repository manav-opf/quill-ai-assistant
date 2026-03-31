/**
 * Preload — exposes a minimal, typed-safe bridge to the renderer (no raw Node APIs).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * @param {{ role: string, content: string }[]} messages
   * @param {{ temperature?: number }} [options]
   * @returns {Promise<{ ok: boolean, text?: string, error?: string }>}
   */
  openaiChat(messages, options = {}) {
    return ipcRenderer.invoke('openai-chat', { messages, ...options });
  },

  /**
   * Generate .pptx from slide definitions; opens system save dialog.
   * @param {{ title: string, bullets: string[] }[]} slides
   * @returns {Promise<{ ok: boolean, path?: string, canceled?: boolean, error?: string }>}
   */
  savePPTX(slides) {
    return ipcRenderer.invoke('save-pptx', slides);
  },
});
