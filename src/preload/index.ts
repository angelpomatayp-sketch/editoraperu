import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type TotemApi } from '../shared/ipc'

/** API mínima expuesta a la interfaz; no da acceso a Node.js, al disco ni a la base de datos. */
const api: TotemApi = {
  getStatus: () => ipcRenderer.invoke(IPC.getStatus),
  getPublicSettings: () => ipcRenderer.invoke(IPC.getPublicSettings),
  listAttractMedia: () => ipcRenderer.invoke(IPC.listAttractMedia),
  reportMediaError: (id) => ipcRenderer.invoke(IPC.reportMediaError, id),
  startSession: () => ipcRenderer.invoke(IPC.startSession),
  endSession: (sessionId, reason) => ipcRenderer.invoke(IPC.endSession, sessionId, reason),
  listCampaigns: (sessionId) => ipcRenderer.invoke(IPC.listCampaigns, sessionId),
  selectCampaign: (sessionId, campaignId) => ipcRenderer.invoke(IPC.selectCampaign, sessionId, campaignId),
  listConsents: () => ipcRenderer.invoke(IPC.listConsents),
  register: (input) => ipcRenderer.invoke(IPC.register, input),
  saveCapture: (sessionId, frame, guide) => ipcRenderer.invoke(IPC.saveCapture, sessionId, frame, guide),
  compose: (sessionId, placements, frame) => ipcRenderer.invoke(IPC.compose, sessionId, placements, frame ?? null),
  retake: (sessionId) => ipcRenderer.invoke(IPC.retake, sessionId),
  reportCameraProblem: (problem) => ipcRenderer.invoke(IPC.reportCameraProblem, problem),
  publish: (sessionId) => ipcRenderer.invoke(IPC.publish, sessionId),
  reservedGesture: () => ipcRenderer.invoke(IPC.reservedGesture),
  confirmQuit: (confirmed) => ipcRenderer.invoke(IPC.confirmQuit, confirmed),
  adminStatus: () => ipcRenderer.invoke(IPC.adminStatus),
  adminSetup: (payload) => ipcRenderer.invoke(IPC.adminSetup, payload),
  adminLogin: (payload) => ipcRenderer.invoke(IPC.adminLogin, payload),
  admin: (token, method, payload) => ipcRenderer.invoke(IPC.admin, token, method, payload)
}

contextBridge.exposeInMainWorld('totem', api)
