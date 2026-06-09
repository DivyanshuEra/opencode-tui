import { describe, expect, it, beforeEach, vi } from "vitest";
import { PaneStore, type PaneState } from "../PaneStore";

function createPane(overrides: Partial<PaneState> = {}): PaneState {
  return {
    paneId: overrides.paneId ?? crypto.randomUUID(),
    tabId: overrides.tabId ?? "tab-1",
    isActive: overrides.isActive ?? false,
    size: overrides.size ?? 50,
    splitDirection: overrides.splitDirection,
    cwd: overrides.cwd,
    command: overrides.command,
    backend: overrides.backend,
  };
}

describe("PaneStore", () => {
  let store: PaneStore;
  beforeEach(() => {
    store = new PaneStore();
  });

  it("adds a pane and emits pane-add", () => {
    const pane = createPane({ paneId: "pane-1", tabId: "tab-1" });
    const addListener = vi.fn();
    const changeListener = vi.fn();
    store.on("pane-add", addListener);
    store.on("change", changeListener);

    store.addPane(pane);

    expect(store.getPane("pane-1")).toEqual({ ...pane, isActive: true });
    expect(addListener).toHaveBeenCalledWith({ ...pane, isActive: true });
    expect(changeListener).toHaveBeenCalledTimes(1);
  });

  it("removes a pane, emits pane-remove, and clears active pane cleanup", () => {
    const pane1 = createPane({ paneId: "pane-1", tabId: "tab-1", isActive: true });
    const pane2 = createPane({ paneId: "pane-2", tabId: "tab-1" });
    const removeListener = vi.fn();
    store.on("pane-remove", removeListener);

    store.addPane(pane1);
    store.addPane(pane2);

    store.removePane("pane-1");

    expect(removeListener).toHaveBeenCalledWith("pane-1");
    expect(store.getPane("pane-1")).toBeUndefined();
    expect(store.getActivePane()).toBeUndefined();
    expect(store.getActiveTab()).toBeNull();
    expect(store.getPanesByTab("tab-1")).toHaveLength(1);
  });

  it("sets active pane and emits pane-focus", () => {
    const pane1 = createPane({ paneId: "pane-1", tabId: "tab-1" });
    const pane2 = createPane({ paneId: "pane-2", tabId: "tab-2" });
    const focusListener = vi.fn();
    store.on("pane-focus", focusListener);

    store.addPane(pane1);
    store.addPane(pane2);
    store.setActivePane("pane-2");

    expect(focusListener).toHaveBeenCalledWith("pane-2");
    expect(store.getActivePane()?.paneId).toBe("pane-2");
    expect(store.getActiveTab()).toBe("tab-2");
  });

  it("groups panes by tab", () => {
    store.addPane(createPane({ paneId: "pane-1", tabId: "tab-1" }));
    store.addPane(createPane({ paneId: "pane-2", tabId: "tab-1" }));
    store.addPane(createPane({ paneId: "pane-3", tabId: "tab-2" }));

    expect(store.getPanesByTab("tab-1")).toHaveLength(2);
    expect(store.getPanesByTab("tab-2").map((pane) => pane.paneId)).toEqual([
      "pane-3",
    ]);
  });

  it("tracks active tab as active pane changes", () => {
    store.addPane(createPane({ paneId: "pane-1", tabId: "tab-1" }));
    store.addPane(createPane({ paneId: "pane-2", tabId: "tab-2" }));

    expect(store.getActiveTab()).toBe("tab-1");

    store.setActivePane("pane-2");

    expect(store.getActiveTab()).toBe("tab-2");
  });

  it("updates pane size and emits pane-resize", () => {
    const pane = createPane({ paneId: "pane-1", tabId: "tab-1" });
    const resizeListener = vi.fn();
    store.on("pane-resize", resizeListener);

    store.addPane(pane);
    store.updatePaneSize("pane-1", 75);

    expect(store.getPane("pane-1")?.size).toBe(75);
    expect(resizeListener).toHaveBeenCalledWith("pane-1", 75);
  });

  it("switches active flags when active pane changes", () => {
    store.addPane(createPane({ paneId: "pane-1", tabId: "tab-1", isActive: true }));
    store.addPane(createPane({ paneId: "pane-2", tabId: "tab-1" }));

    store.setActivePane("pane-2");

    expect(store.getPane("pane-1")?.isActive).toBe(false);
    expect(store.getPane("pane-2")?.isActive).toBe(true);
  });

  it("clears everything on dispose", () => {
    store.addPane(createPane({ paneId: "pane-1", tabId: "tab-1", isActive: true }));
    store.addPane(createPane({ paneId: "pane-2", tabId: "tab-2" }));

    store.dispose();

    expect(store.getAllPanes().size).toBe(0);
    expect(store.getActivePane()).toBeUndefined();
    expect(store.getActiveTab()).toBeNull();
    expect(store.listenerCount("pane-add")).toBe(0);
    expect(store.listenerCount("change")).toBe(0);
  });

  it("clears activePaneId when removing the active pane", () => {
    store.addPane(createPane({ paneId: "pane-1", tabId: "tab-1", isActive: true }));
    store.addPane(createPane({ paneId: "pane-2", tabId: "tab-1" }));

    store.removePane("pane-1");

    expect(store.getActivePane()).toBeUndefined();
    expect(store.getActiveTab()).toBeNull();
  });

  it("defaults backend to undefined (treated as native)", () => {
    store.addPane(createPane({ paneId: "pane-1", tabId: "tab-1" }));
    expect(store.getPane("pane-1")?.backend).toBeUndefined();
    expect(store.getPanesByBackend("native")).toHaveLength(1);
    expect(store.getPanesByBackend("tmux")).toHaveLength(0);
  });

  it("stores explicit backend on pane", () => {
    store.addPane(createPane({ paneId: "pane-1", tabId: "tab-1", backend: "tmux" }));
    expect(store.getPane("pane-1")?.backend).toBe("tmux");
    expect(store.getPanesByBackend("tmux")).toHaveLength(1);
    expect(store.getPanesByBackend("native")).toHaveLength(0);
  });

  it("switches pane backend and emits backendChanged", () => {
    store.addPane(createPane({ paneId: "pane-1", tabId: "tab-1" }));
    const backendListener = vi.fn();
    const changeListener = vi.fn();
    store.on("backendChanged", backendListener);
    store.on("change", changeListener);

    store.switchPaneBackend("pane-1", "tmux");

    expect(store.getPane("pane-1")?.backend).toBe("tmux");
    expect(backendListener).toHaveBeenCalledWith("pane-1", undefined, "tmux");
    expect(changeListener).toHaveBeenCalledTimes(1);
  });

  it("switches backend from tmux to zellij", () => {
    store.addPane(createPane({ paneId: "pane-1", tabId: "tab-1", backend: "tmux" }));
    const backendListener = vi.fn();
    store.on("backendChanged", backendListener);

    store.switchPaneBackend("pane-1", "zellij");

    expect(store.getPane("pane-1")?.backend).toBe("zellij");
    expect(backendListener).toHaveBeenCalledWith("pane-1", "tmux", "zellij");
  });

  it("no-ops when switching to same backend", () => {
    store.addPane(createPane({ paneId: "pane-1", tabId: "tab-1", backend: "tmux" }));
    const backendListener = vi.fn();
    store.on("backendChanged", backendListener);

    store.switchPaneBackend("pane-1", "tmux");

    expect(backendListener).not.toHaveBeenCalled();
  });

  it("throws when switching backend of unknown pane", () => {
    expect(() => store.switchPaneBackend("nonexistent", "tmux")).toThrow(
      "Cannot switch backend: unknown pane 'nonexistent'"
    );
  });

  it("getPanesByBackend filters mixed backends", () => {
    store.addPane(createPane({ paneId: "pane-1", tabId: "tab-1" })); // native (undefined)
    store.addPane(createPane({ paneId: "pane-2", tabId: "tab-1", backend: "tmux" }));
    store.addPane(createPane({ paneId: "pane-3", tabId: "tab-1", backend: "zellij" }));
    store.addPane(createPane({ paneId: "pane-4", tabId: "tab-1", backend: "tmux" }));

    expect(store.getPanesByBackend("native")).toHaveLength(1);
    expect(store.getPanesByBackend("tmux")).toHaveLength(2);
    expect(store.getPanesByBackend("zellij")).toHaveLength(1);
  });
});
