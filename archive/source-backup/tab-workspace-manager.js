"use strict";

const DEFAULT_WORKSPACE_ID = "personal";
const DEFAULT_WORKSPACE_NAME = "Personal";

function normalizeId(value, label) {
  const id = String(value || "").trim();
  if (!id) throw new TypeError(`${label} must be a non-empty string.`);
  return id;
}

function toSerializableMetadata(metadata) {
  try {
    return JSON.parse(JSON.stringify(metadata || {}));
  } catch {
    throw new TypeError("Tab metadata must be JSON-serializable.");
  }
}

/**
 * Owns the main-process relationship between tabs, workspaces, and visible
 * panes. Electron View instances stay in this class and never cross IPC.
 *
 * The manager intentionally does not call setVisible() or setBounds(). It
 * returns a visibility plan so one main-process layout function can apply all
 * view mutations atomically. That prevents flicker while switching workspaces.
 */
class TabWorkspaceManager {
  constructor({
    defaultWorkspaceId = DEFAULT_WORKSPACE_ID,
    defaultWorkspaceName = DEFAULT_WORKSPACE_NAME,
    maxVisibleTabs = 2,
    clock = Date.now
  } = {}) {
    if (!Number.isInteger(maxVisibleTabs) || maxVisibleTabs < 1) {
      throw new TypeError("maxVisibleTabs must be a positive integer.");
    }
    if (typeof clock !== "function") {
      throw new TypeError("clock must be a function.");
    }

    this.tabs = new Map();
    this.workspaces = new Map();
    this.maxVisibleTabs = maxVisibleTabs;
    this.clock = clock;
    this.activeWorkspaceId = null;

    const workspace = this.createWorkspace({
      id: defaultWorkspaceId,
      name: defaultWorkspaceName
    });
    this.activeWorkspaceId = workspace.id;
  }

  createWorkspace({ id, name, color = "", sessionPartition = "" }) {
    const workspaceId = normalizeId(id, "Workspace id");
    if (this.workspaces.has(workspaceId)) {
      throw new Error(`Workspace "${workspaceId}" already exists.`);
    }

    const workspace = {
      id: workspaceId,
      name: String(name || workspaceId).trim() || workspaceId,
      color: String(color || ""),
      sessionPartition: String(sessionPartition || ""),
      tabIds: [],
      activeTabIds: [],
      createdAt: this.clock(),
      lastActiveAt: 0
    };
    this.workspaces.set(workspaceId, workspace);
    if (!this.activeWorkspaceId) this.activeWorkspaceId = workspaceId;
    return workspace;
  }

  registerTab({
    id,
    view,
    workspaceId = this.activeWorkspaceId,
    activate = true,
    metadata = {}
  }) {
    const tabId = normalizeId(id, "Tab id");
    const targetWorkspaceId = normalizeId(workspaceId, "Workspace id");
    if (this.tabs.has(tabId)) throw new Error(`Tab "${tabId}" already exists.`);
    if (!view || !["object", "function"].includes(typeof view)) {
      throw new TypeError("Tab view must be an Electron WebContentsView-like object.");
    }

    const workspace = this.requireWorkspace(targetWorkspaceId);
    const timestamp = this.clock();
    const tab = {
      id: tabId,
      view,
      workspaceId: targetWorkspaceId,
      metadata: toSerializableMetadata(metadata),
      createdAt: timestamp,
      lastActiveAt: activate ? timestamp : 0
    };

    this.tabs.set(tabId, tab);
    workspace.tabIds.push(tabId);
    if (activate || workspace.activeTabIds.length === 0) {
      workspace.activeTabIds = [tabId];
      workspace.lastActiveAt = timestamp;
    }
    return tab;
  }

  unregisterTab(tabId) {
    const id = normalizeId(tabId, "Tab id");
    const tab = this.tabs.get(id);
    if (!tab) return null;

    const workspace = this.requireWorkspace(tab.workspaceId);
    this.tabs.delete(id);
    workspace.tabIds = workspace.tabIds.filter((candidate) => candidate !== id);
    workspace.activeTabIds = workspace.activeTabIds.filter((candidate) => candidate !== id);

    if (workspace.activeTabIds.length === 0 && workspace.tabIds.length > 0) {
      const fallback = workspace.tabIds
        .map((candidate) => this.tabs.get(candidate))
        .filter(Boolean)
        .sort((left, right) => right.lastActiveAt - left.lastActiveAt)[0];
      if (fallback) workspace.activeTabIds = [fallback.id];
    }
    return tab;
  }

  setActiveWorkspace(workspaceId) {
    const workspace = this.requireWorkspace(workspaceId);
    this.activeWorkspaceId = workspace.id;
    workspace.lastActiveAt = this.clock();
    return workspace;
  }

  /**
   * Sets the complete pane selection for a workspace. One tab means single
   * view; two tabs reserve state for Split View without doing layout math yet.
   */
  setActiveTabs(workspaceId, tabIds) {
    const workspace = this.requireWorkspace(workspaceId);
    const uniqueIds = [...new Set((tabIds || []).map((id) => normalizeId(id, "Tab id")))];
    if (uniqueIds.length > this.maxVisibleTabs) {
      throw new Error(`A workspace can show at most ${this.maxVisibleTabs} tabs.`);
    }

    for (const tabId of uniqueIds) {
      const tab = this.requireTab(tabId);
      if (tab.workspaceId !== workspace.id) {
        throw new Error(`Tab "${tabId}" does not belong to workspace "${workspace.id}".`);
      }
    }

    const timestamp = this.clock();
    workspace.activeTabIds = uniqueIds;
    workspace.lastActiveAt = timestamp;
    uniqueIds.forEach((tabId) => {
      this.tabs.get(tabId).lastActiveAt = timestamp;
    });
    return [...workspace.activeTabIds];
  }

  activateTab(tabId, { preserveOtherPanes = false, paneIndex = 0 } = {}) {
    const tab = this.requireTab(tabId);
    const workspace = this.requireWorkspace(tab.workspaceId);
    this.setActiveWorkspace(workspace.id);

    if (!preserveOtherPanes) {
      this.setActiveTabs(workspace.id, [tab.id]);
      return tab;
    }

    if (!Number.isInteger(paneIndex) || paneIndex < 0 || paneIndex >= this.maxVisibleTabs) {
      throw new RangeError(`paneIndex must be between 0 and ${this.maxVisibleTabs - 1}.`);
    }

    const nextActiveTabs = workspace.activeTabIds.filter((id) => id !== tab.id);
    nextActiveTabs.splice(Math.min(paneIndex, nextActiveTabs.length), 0, tab.id);
    this.setActiveTabs(workspace.id, nextActiveTabs.slice(0, this.maxVisibleTabs));
    return tab;
  }

  moveTabToWorkspace(tabId, workspaceId, { activate = true } = {}) {
    const tab = this.requireTab(tabId);
    const source = this.requireWorkspace(tab.workspaceId);
    const target = this.requireWorkspace(workspaceId);
    if (source.id === target.id) {
      if (activate) this.activateTab(tab.id);
      return tab;
    }

    source.tabIds = source.tabIds.filter((id) => id !== tab.id);
    source.activeTabIds = source.activeTabIds.filter((id) => id !== tab.id);
    target.tabIds.push(tab.id);
    tab.workspaceId = target.id;

    if (source.activeTabIds.length === 0 && source.tabIds.length > 0) {
      source.activeTabIds = [source.tabIds[0]];
    }
    if (activate || target.activeTabIds.length === 0) {
      this.setActiveWorkspace(target.id);
      this.setActiveTabs(target.id, [tab.id]);
    }
    return tab;
  }

  updateTabMetadata(tabId, patch) {
    const tab = this.requireTab(tabId);
    tab.metadata = {
      ...tab.metadata,
      ...toSerializableMetadata(patch)
    };
    return { ...tab.metadata };
  }

  getVisibleTabIds() {
    const workspace = this.workspaces.get(this.activeWorkspaceId);
    return workspace ? [...workspace.activeTabIds] : [];
  }

  /**
   * The main process consumes this plan to hide all non-active views, place
   * active views in pane order, and focus only the requested pane.
   */
  getVisibilityPlan() {
    const visibleIds = new Map(
      this.getVisibleTabIds().map((tabId, paneIndex) => [tabId, paneIndex])
    );
    return [...this.tabs.values()].map((tab) => ({
      tabId: tab.id,
      workspaceId: tab.workspaceId,
      view: tab.view,
      visible: visibleIds.has(tab.id),
      paneIndex: visibleIds.get(tab.id) ?? -1
    }));
  }

  /**
   * Safe IPC payload for the renderer. Native Electron objects are excluded.
   */
  snapshot() {
    const visibleIds = new Set(this.getVisibleTabIds());
    return {
      activeWorkspaceId: this.activeWorkspaceId,
      visibleTabIds: [...visibleIds],
      workspaces: [...this.workspaces.values()].map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        color: workspace.color,
        sessionPartition: workspace.sessionPartition,
        tabIds: [...workspace.tabIds],
        activeTabIds: [...workspace.activeTabIds],
        createdAt: workspace.createdAt,
        lastActiveAt: workspace.lastActiveAt
      })),
      tabs: [...this.tabs.values()].map((tab) => ({
        id: tab.id,
        workspaceId: tab.workspaceId,
        visible: visibleIds.has(tab.id),
        metadata: toSerializableMetadata(tab.metadata),
        createdAt: tab.createdAt,
        lastActiveAt: tab.lastActiveAt
      }))
    };
  }

  requireWorkspace(workspaceId) {
    const id = normalizeId(workspaceId, "Workspace id");
    const workspace = this.workspaces.get(id);
    if (!workspace) throw new Error(`Unknown workspace "${id}".`);
    return workspace;
  }

  requireTab(tabId) {
    const id = normalizeId(tabId, "Tab id");
    const tab = this.tabs.get(id);
    if (!tab) throw new Error(`Unknown tab "${id}".`);
    return tab;
  }
}

module.exports = {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  TabWorkspaceManager
};
