'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  persons: {
    list: () => ipcRenderer.invoke('persons:list'),
    get: (id) => ipcRenderer.invoke('persons:get', id),
    save: (p) => ipcRenderer.invoke('persons:save', p),
    remove: (id) => ipcRenderer.invoke('persons:delete', id),
    due: () => ipcRenderer.invoke('persons:due')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  },
  seco: {
    meta: () => ipcRenderer.invoke('seco:meta'),
    refresh: () => ipcRenderer.invoke('seco:refresh')
  },
  dilisense: {
    test: (key) => ipcRenderer.invoke('dilisense:test', key)
  },
  screening: {
    person: (id) => ipcRenderer.invoke('screening:person', id),
    due: () => ipcRenderer.invoke('screening:due'),
    onProgress: (cb) => ipcRenderer.on('screening:progress', (_e, d) => cb(d))
  },
  scheduler: {
    status: () => ipcRenderer.invoke('scheduler:status'),
    install: (opts) => ipcRenderer.invoke('scheduler:install', opts),
    remove: () => ipcRenderer.invoke('scheduler:remove')
  },
  docx: {
    template: (name) => ipcRenderer.invoke('docx:template', name),
    fieldmap: () => ipcRenderer.invoke('docx:fieldmap'),
    save: (name, ab) => ipcRenderer.invoke('docx:save', name, ab)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
  }
});
