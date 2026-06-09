// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostMessage, WebviewMessage } from "../../types";
import { PaneMessageRouter } from "../pane-message-router";

interface PaneManagerMock {
  writeData: ReturnType<typeof vi.fn>;
  resizePane: ReturnType<typeof vi.fn>;
  focusPane: ReturnType<typeof vi.fn>;
  getPane: ReturnType<typeof vi.fn>;
}

describe("PaneMessageRouter", () => {
  let router: PaneMessageRouter;
  let clearTerminal: ReturnType<typeof vi.fn>;
  let paneManager: PaneManagerMock;

  beforeEach(() => {
    router = new PaneMessageRouter();
    clearTerminal = vi.fn();
    paneManager = {
      writeData: vi.fn(),
      resizePane: vi.fn(),
      focusPane: vi.fn(),
      getPane: vi.fn(() => ({ terminal: { clear: clearTerminal } })),
    };
  });

  it("starts with the default focused pane", () => {
    expect(router.getFocusedPane()).toBe("default");
  });

  it("updates and returns the focused pane", () => {
    router.setFocusedPane("pane-2");

    expect(router.getFocusedPane()).toBe("pane-2");
  });

  it("falls back to the default pane id when none is provided", () => {
    expect(router.resolvePaneId()).toBe("default");
    expect(router.resolvePaneId("pane-3")).toBe("pane-3");
  });

  it("routes terminal output to the targeted pane", () => {
    const message: HostMessage = {
      type: "terminalOutput",
      data: "hello",
      paneId: "pane-b",
    };

    router.handleHostMessage(message, paneManager as never);

    expect(paneManager.writeData).toHaveBeenCalledWith("pane-b", "hello");
  });

  it("routes terminal output to the default pane when paneId is missing", () => {
    const message: HostMessage = { type: "terminalOutput", data: "hello" };

    router.handleHostMessage(message, paneManager as never);

    expect(paneManager.writeData).toHaveBeenCalledWith("default", "hello");
  });

  it("routes terminal resize to the targeted pane", () => {
    const message: Extract<WebviewMessage, { type: "terminalResize" }> = {
      type: "terminalResize",
      cols: 120,
      rows: 40,
      paneId: "pane-c",
    };

    router.handleHostMessage(message, paneManager as never);

    expect(paneManager.resizePane).toHaveBeenCalledWith("pane-c", 120, 40);
  });

  it("focuses the requested pane and tracks it as focused", () => {
    const message: HostMessage = { type: "focusTerminal", paneId: "pane-d" };

    router.handleHostMessage(message, paneManager as never);

    expect(paneManager.focusPane).toHaveBeenCalledWith("pane-d");
    expect(router.getFocusedPane()).toBe("pane-d");
  });

  it("clears the targeted pane terminal", () => {
    const message: HostMessage = { type: "clearTerminal", paneId: "pane-e" };

    router.handleHostMessage(message, paneManager as never);

    expect(paneManager.getPane).toHaveBeenCalledWith("pane-e");
    expect(clearTerminal).toHaveBeenCalledTimes(1);
  });

  it("skips clearing when the pane does not exist", () => {
    paneManager.getPane.mockReturnValue(undefined);
    const message: HostMessage = { type: "clearTerminal" };

    expect(() =>
      router.handleHostMessage(message, paneManager as never),
    ).not.toThrow();
    expect(paneManager.getPane).toHaveBeenCalledWith("default");
    expect(clearTerminal).not.toHaveBeenCalled();
  });

  it("injects the provided focused pane id into outgoing messages", () => {
    const message: WebviewMessage = { type: "terminalInput", data: "pwd" };

    expect(router.injectPaneId(message, "pane-f")).toEqual({
      type: "terminalInput",
      data: "pwd",
      paneId: "pane-f",
    });
  });

  it("preserves an explicit pane id when injecting outgoing messages", () => {
    const message: WebviewMessage = {
      type: "terminalResize",
      cols: 80,
      rows: 24,
      paneId: "pane-g",
    };

    expect(router.injectPaneId(message, "pane-f")).toEqual(message);
  });

  it("uses the tracked focused pane when injectPaneId omits the override", () => {
    router.setFocusedPane("pane-h");
    const message: WebviewMessage = { type: "triggerPaste" };

    expect(router.injectPaneId(message)).toEqual({
      type: "triggerPaste",
      paneId: "pane-h",
    });
  });
});
