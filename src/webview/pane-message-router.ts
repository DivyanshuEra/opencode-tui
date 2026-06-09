import type { HostMessage, WebviewMessage } from "../types";
import type { PaneManager } from "./pane-manager";

type PaneHostMessage =
  | HostMessage
  | Extract<WebviewMessage, { type: "terminalResize" }>;

export class PaneMessageRouter {
  private focusedPaneId = "default";

  handleHostMessage(message: PaneHostMessage, paneManager: PaneManager): void {
    switch (message.type) {
      case "terminalOutput": {
        paneManager.writeData(this.resolvePaneId(message.paneId), message.data);
        break;
      }

      case "terminalResize": {
        paneManager.resizePane(
          this.resolvePaneId(message.paneId),
          message.cols,
          message.rows,
        );
        break;
      }

      case "focusTerminal": {
        const paneId = this.resolvePaneId(message.paneId);
        this.setFocusedPane(paneId);
        paneManager.focusPane(paneId);
        break;
      }

      case "clearTerminal": {
        const pane = paneManager.getPane(this.resolvePaneId(message.paneId));
        pane?.terminal.clear();
        break;
      }
    }
  }

  injectPaneId<T extends WebviewMessage>(
    message: T,
    focusedPaneId: string = this.focusedPaneId,
  ): T {
    const paneId = this.resolvePaneId(message.paneId ?? focusedPaneId);
    return { ...message, paneId };
  }

  setFocusedPane(paneId: string): void {
    this.focusedPaneId = this.resolvePaneId(paneId);
  }

  getFocusedPane(): string {
    return this.focusedPaneId;
  }

  resolvePaneId(paneId?: string): string {
    return paneId || "default";
  }
}
