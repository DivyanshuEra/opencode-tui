import "@xterm/xterm/css/xterm.css";
import * as TmuxPrompt from "./tmux-prompt";
import * as AiSelector from "./ai-tool-selector";
import * as TmuxCmd from "./tmux-command-dropdown";
import { HostMessage } from "../types";
import { PaneManager } from "./pane-manager";
import { PaneMessageRouter } from "./pane-message-router";
import { LayoutEngine } from "./layout/layout-engine";
import { TabBar } from "./tab-bar/tab-bar";
import { PaneActions } from "./pane-actions/pane-actions";
import { FocusManager } from "./focus/focus-manager";
import type { TerminalBackendAvailability, TerminalBackendType } from "../types";
import {
  copySelectionToClipboard,
  handlePasteEventWithImageSupport,
} from "./clipboard";
import { postMessage } from "./shared/vscode-api";
import { initTerminal } from "./terminal";
import { createMessageHandler, type MessageHandlerCallbacks } from "./messages";
import {
  setupEditorAttachmentButton,
  setupReloadButton,
  setupCloseTerminalButton,
  setupTmuxCommandButton,
  setupTmuxWindowButtons,
  setupBackendToggleButton,
  updateBackendToggleButtonState,
} from "./toolbar";

let currentSessionId: string | null = null;
let activeBackend: TerminalBackendType = "native";
let backendAvailability: TerminalBackendAvailability = {
  native: true,
  tmux: true,
  zellij: false,
};

type UlwSurfaceWindow = Window & {
  __ULW_SURFACE_PANE_ID__?: string;
};

function getSurfacePaneId(): string {
  const surfacePaneId = (window as UlwSurfaceWindow).__ULW_SURFACE_PANE_ID__;
  return surfacePaneId && surfacePaneId.trim().length > 0
    ? surfacePaneId
    : "default";
}

function toggleTmuxCommandMenu(): void {
  if (!currentSessionId) {
    return;
  }

  if (TmuxCmd.isVisible()) {
    TmuxCmd.hide();
  } else {
    TmuxCmd.show(currentSessionId, activeBackend);
  }
}

function updateBackendOnlyElements(): void {
  const elements = document.querySelectorAll("[data-tmux-only]");
  Array.from(elements).forEach((el) => {
    if (el instanceof HTMLElement) {
      el.style.display = backendAvailability.tmux ? "" : "none";
    }
  });
  const zellijElements = document.querySelectorAll("[data-zellij-only]");
  Array.from(zellijElements).forEach((el) => {
    if (el instanceof HTMLElement) {
      el.style.display = backendAvailability.zellij ? "" : "none";
    }
  });
}

const callbacks: MessageHandlerCallbacks = {
  onActiveSession(message) {
    const toolbar = document.getElementById("tmux-toolbar");
    const label = document.getElementById("tmux-session-label");
    const toolbarControls = document.querySelector(".toolbar-controls");

    if (toolbar) toolbar.classList.remove("hidden");

    if ("sessionName" in message && message.sessionName) {
      currentSessionId = message.sessionId;
      activeBackend = message.backend ?? "tmux";
      if (label) {
        const windowSuffix =
          message.windowIndex !== undefined
            ? ` [${message.windowIndex}]${message.windowName ? ` ${message.windowName}` : ""}`
            : "";
        const backendPrefix = activeBackend === "zellij" ? "Zellij: " : "";
        label.textContent = backendPrefix + message.sessionName + windowSuffix;
      }
      if (toolbarControls) {
        if (activeBackend === "tmux" || activeBackend === "zellij") {
          toolbarControls.classList.remove("hidden");
        } else {
          toolbarControls.classList.add("hidden");
        }
      }
    } else {
      currentSessionId = null;
      activeBackend = "native";
      if (label) label.textContent = "Native Shell";
      if (toolbarControls) {
        toolbarControls.classList.add("hidden");
      }
    }

    updateBackendToggleButtonState(activeBackend, backendAvailability);
  },

  onToggleTmuxCommandToolbar() {
    toggleTmuxCommandMenu();
  },

  onShowAiToolSelector(message) {
    AiSelector.show(
      message.sessionId,
      message.sessionName,
      message.defaultTool,
      message.tools,
      message.targetPaneId,
    );
  },

  onShowTmuxPrompt(message) {
    backendAvailability.tmux = message.tmuxAvailable !== false;
    backendAvailability.zellij = message.zellijAvailable === true;
    const choice = backendAvailability.tmux ? "tmux" : "shell";
    postMessage({
      type: "sendTmuxPromptChoice",
      choice,
    });
  },

  onPlatformInfo(message) {
    backendAvailability = message.backendAvailability ?? {
      native: true,
      tmux: message.tmuxAvailable !== false,
      zellij: message.zellijAvailable === true,
    };
    activeBackend = message.activeBackend ?? activeBackend;
    updateBackendOnlyElements();
    updateBackendToggleButtonState(activeBackend, backendAvailability);
  },
};

const messageHandler = createMessageHandler(callbacks);

function initApp(): void {
  const container = document.getElementById("terminal-container");
  if (!container) return;
  const surfacePaneId = getSurfacePaneId();

  const instance = initTerminal(container, {
    onData: (data) => {
      postMessage({ type: "terminalInput", data, paneId: surfacePaneId });
    },
    onResize: (cols, rows) => {
      postMessage({ type: "terminalResize", cols, rows, paneId: surfacePaneId });
    },
    onToggleTmuxCommands: () => {
      toggleTmuxCommandMenu();
    },
  });

  if (instance) {
    messageHandler.terminal = instance.terminal;
    messageHandler.fitAddon = instance.fitAddon;
  }

  const multiPaneContainer = document.getElementById("terminal-layout-root") ?? container;
  const paneManager = new PaneManager();
  paneManager.init(multiPaneContainer);
  const paneRouter = new PaneMessageRouter();
  const layoutEngine = new LayoutEngine(multiPaneContainer);
  const tabBar = new TabBar(paneManager, paneRouter);
  const focusManager = new FocusManager(paneManager, paneRouter);
  focusManager.init(multiPaneContainer);

  if (multiPaneContainer.parentNode) {
    multiPaneContainer.parentNode.insertBefore(tabBar.getElement(), multiPaneContainer);
  }

  const rootNode = {
    paneId: surfacePaneId,
    element: container,
  };
  (layoutEngine as any).rootNode = rootNode;
  (layoutEngine as any).paneMap.set(surfacePaneId, rootNode);

  const paneActions = new PaneActions({
    layoutEngine,
    paneManager,
    getFocusedPaneId: () => focusManager.getFocusedPane(),
    getCurrentPaneCount: () => paneManager.getAllPaneIds().length,
    getLayoutRoot: () => multiPaneContainer,
  });
  paneActions.init(
    document.getElementById("pane-actions-container") ?? undefined,
  );

  paneManager.registerPane(surfacePaneId, instance?.terminal ?? null, container);
  focusManager.registerPane(surfacePaneId, container);
  tabBar.addTab(surfacePaneId, "Terminal");
  tabBar.setPanesForTab(surfacePaneId, [surfacePaneId]);

  const createNewNativeTab = () => {
    const paneId = `pane-native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const newContainer = document.createElement("div");
    newContainer.className = "layout-pane";
    newContainer.dataset.paneId = paneId;
    newContainer.style.display = "none";
    multiPaneContainer.appendChild(newContainer);
    paneManager.registerPane(paneId, null, newContainer, "native");
    focusManager.registerPane(paneId, newContainer);
    const tabNum = tabBar.getTabCount() + 1;
    tabBar.addTab(paneId, `Terminal ${tabNum}`);
    tabBar.setPanesForTab(paneId, [paneId]);
    postMessage({ type: "paneCreate", paneId, direction: "horizontal" });
    tabBar.switchTab(paneId);
  };

  tabBar.onTabAdd(() => {
    if (activeBackend === "native") {
      createNewNativeTab();
    } else {
      postMessage({ type: "paneCreate" });
    }
  });

  tabBar.onTabClose((tabId) => {
    postMessage({ type: "paneDelete", paneId: tabId });
    paneManager.disposePane(tabId);
    focusManager.unregisterPane(tabId);
    layoutEngine.removePane(tabId);
    tabBar.removeTab(tabId);
    const activeTab = tabBar.getActiveTab();
    if (activeTab) {
      paneManager.showPane(activeTab);
    }
  });

  tabBar.onTabSwitch((tabId) => {
    focusManager.setFocusedPane(tabId);
  });

  container.addEventListener(
    "paste",
    (event: ClipboardEvent) => {
      if (!handlePasteEventWithImageSupport(event)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true },
  );

  container.addEventListener(
    "copy",
    (event: ClipboardEvent) => {
      const selection = instance?.terminal.hasSelection()
        ? instance.terminal.getSelection()
        : "";
      if (!selection) {
        return;
      }

      event.preventDefault();
      copySelectionToClipboard(selection);
    },
    { capture: true },
  );

  setupReloadButton();
  setupCloseTerminalButton();
  setupEditorAttachmentButton();
  setupTmuxCommandButton(() => currentSessionId, () => activeBackend);
  setupTmuxWindowButtons(() => activeBackend);
  setupBackendToggleButton(() => activeBackend);

  const switchNativeTabOffset = (offset: number) => {
    const tabIds = tabBar.getTabIds();
    const activeTab = tabBar.getActiveTab();
    if (tabIds.length <= 1 || !activeTab) return;
    const currentIndex = tabIds.indexOf(activeTab);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + offset + tabIds.length) % tabIds.length;
    tabBar.switchTab(tabIds[nextIndex]);
  };

  document.getElementById("btn-tmux-new-window")?.addEventListener("click", () => {
    if (activeBackend === "native") {
      createNewNativeTab();
    }
  });

  document.getElementById("btn-tmux-prev-window")?.addEventListener("click", () => {
    if (activeBackend === "native") {
      switchNativeTabOffset(-1);
    }
  });

  document.getElementById("btn-tmux-next-window")?.addEventListener("click", () => {
    if (activeBackend === "native") {
      switchNativeTabOffset(1);
    }
  });

  window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as Record<string, unknown> | undefined;
    if (!msg) return;

    if (msg.type === "paneCreate" && "paneId" in msg) {
      const paneId = msg.paneId as string;
      const direction = (msg.direction as string) || "horizontal";
      layoutEngine.splitPane(
        surfacePaneId,
        direction as "horizontal" | "vertical",
        paneId,
      );
      const newContainer = layoutEngine.getPaneElement(paneId);
      if (newContainer) {
        paneManager.registerPane(paneId, null, newContainer);
        focusManager.registerPane(paneId, newContainer);
        tabBar.addTab(paneId, `Terminal ${paneId}`);
        tabBar.setPanesForTab(paneId, [paneId]);
      }
    }
    if (msg.type === "paneBackendChanged" && "paneId" in msg) {
      const paneId = msg.paneId as string;
      const backend = msg.backend as TerminalBackendType;
      paneManager.setBackend(paneId, backend);
      tabBar.setTabBackend(paneId, backend);
    }
    if (msg.type === "paneDelete" && "paneId" in msg) {
      const paneId = msg.paneId as string;
      paneManager.disposePane(paneId);
      focusManager.unregisterPane(paneId);
      layoutEngine.removePane(paneId);
      tabBar.removeTab(paneId);
    }

    // Custom multi-pane/tab message routing
    if (
      msg.type === "terminalOutput" ||
      msg.type === "terminalResize" ||
      msg.type === "focusTerminal" ||
      msg.type === "clearTerminal"
    ) {
      paneRouter.handleHostMessage(msg as HostMessage, paneManager);
    } else if (msg.type === "terminalExited") {
      // Removed text-printing logic completely as requested
    } else if (msg.type === "clipboardContent" && typeof msg.text === "string") {
      const activePaneId = focusManager.getFocusedPane();
      const pane = paneManager.getPane(activePaneId);
      if (pane && !pane.disposed) {
        pane.terminal.paste(msg.text);
      }
    } else if (msg.type === "webviewVisible") {
      setTimeout(() => {
        for (const paneId of paneManager.getAllPaneIds()) {
          const pane = paneManager.getPane(paneId);
          if (pane && !pane.disposed) {
            pane.fitAddon.fit();
            pane.terminal.refresh(0, pane.terminal.rows - 1);
            postMessage({
              type: "terminalResize",
              cols: pane.terminal.cols,
              rows: pane.terminal.rows,
              paneId,
            });
          }
        }
      }, 50);
    } else if (msg.type === "terminalConfig") {
      for (const paneId of paneManager.getAllPaneIds()) {
        const pane = paneManager.getPane(paneId);
        if (pane && !pane.disposed) {
          pane.terminal.options.fontSize = msg.fontSize as number;
          pane.terminal.options.fontFamily = msg.fontFamily as string;
          pane.terminal.options.cursorBlink = msg.cursorBlink as boolean;
          pane.terminal.options.cursorStyle = msg.cursorStyle as "block" | "underline" | "bar";
          pane.fitAddon.fit();
        }
      }
      messageHandler.handleEvent(event as MessageEvent<HostMessage>);
    } else {
      messageHandler.handleEvent(event as MessageEvent<HostMessage>);
    }
  });

  setupAiToolSelectorEvents();
}
const aiCallbacks = {
  postMessage: (msg: unknown) => {
    const m = msg as Record<string, unknown>;
    if (m && m.action === "launchAiTool") {
      postMessage({
        type: "launchAiTool",
        sessionId: String(m.sessionId ?? ""),
        tool: String(m.tool ?? ""),
        savePreference: Boolean(m.savePreference),
        targetPaneId: m.targetPaneId ? String(m.targetPaneId) : undefined,
      });
    }
  },
};

const tmuxPromptCallbacks = {
  postMessage: (msg: unknown) => {
    const m = msg as Record<string, unknown>;
    if (m && m.type === "sendTmuxPromptChoice") {
      postMessage({
        type: "sendTmuxPromptChoice",
        choice: String(m.choice) as "tmux" | "shell" | "zellij",
      });
    }
  },
};

function setupAiToolSelectorEvents(): void {
  document.addEventListener("keydown", (event) => {
    // Cmd/Ctrl+Alt+M → toggle tmux command dropdown
    // VS Code keybindings don't fire when xterm has focus,
    // so we handle this directly in the webview.
    const isToggleTmuxCmd =
      event.altKey && (event.metaKey || event.ctrlKey) && event.code === "KeyM";
    if (isToggleTmuxCmd) {
      if (currentSessionId) {
        event.preventDefault();
        if (TmuxCmd.isVisible()) {
          TmuxCmd.hide();
        } else {
          TmuxCmd.show(currentSessionId, activeBackend);
        }
      }
      return;
    }

    if (TmuxCmd.isVisible()) {
      if (TmuxCmd.handleKeydown(event)) {
        return;
      }
    }
    if (AiSelector.isVisible()) {
      AiSelector.handleKeydown(event, aiCallbacks);
    }
  });

  document.addEventListener("click", (event) => {
    const target = event
      .composedPath()
      .find((el): el is Element => el instanceof Element);
    if (!target) return;
    if (AiSelector.isVisible()) {
      AiSelector.handleClick(target, aiCallbacks);
    }

    if (TmuxPrompt.isVisible()) {
      TmuxPrompt.handleClick(target, tmuxPromptCallbacks);
    }

    if (TmuxCmd.isVisible()) {
      if (
        target.closest(".tmux-cmd-item") &&
        !target.closest(".tmux-cmd-item.disabled")
      ) {
        TmuxCmd.handleClick(target);
      } else if (
        !target.closest("#tmux-command-dropdown") &&
        !target.closest("#btn-tmux-commands")
      ) {
        TmuxCmd.hide();
      }
    }
  });
}

const boot = () => {
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => initApp());
  } else {
    initApp();
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
