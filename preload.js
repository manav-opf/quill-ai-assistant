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
});
