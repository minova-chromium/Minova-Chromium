"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minovaAssistantEngine", {
  testMode: process.env.MINOVA_AI_TEST_MODE === "1",
  emit: (payload) => ipcRenderer.send("assistant-engine:event", payload),
  onCommand: (callback) => {
    ipcRenderer.on("assistant-engine:command", (_event, command) => callback(command));
  }
});

