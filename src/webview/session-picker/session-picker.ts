import { postMessage } from "../shared/vscode-api";

export interface SessionInfo {
  id: string;
  name: string;
  backend: "tmux" | "zellij";
  windows?: number;
  attached?: boolean;
}

export class SessionPicker {
  private readonly element: HTMLDivElement;
  private readonly listElement: HTMLUListElement;
  private sessions: SessionInfo[] = [];

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "session-picker";

    const header = document.createElement("div");
    header.className = "session-picker__header";
    header.textContent = "Sessions";
    this.element.appendChild(header);

    this.listElement = document.createElement("ul");
    this.listElement.className = "session-picker__list";
    this.element.appendChild(this.listElement);
  }

  getElement(): HTMLDivElement {
    return this.element;
  }

  setSessions(sessions: SessionInfo[]): void {
    this.sessions = sessions;
    this.renderList();
  }

  getSessions(): SessionInfo[] {
    return this.sessions;
  }

  private renderList(): void {
    this.listElement.innerHTML = "";

    if (this.sessions.length === 0) {
      const emptyItem = document.createElement("li");
      emptyItem.className = "session-picker__empty";
      emptyItem.textContent = "No sessions found";
      this.listElement.appendChild(emptyItem);
      return;
    }

    for (const session of this.sessions) {
      const item = document.createElement("li");
      item.className = "session-picker__item";
      if (session.attached) {
        item.classList.add("session-picker__item--active");
      }

      const backendBadge = document.createElement("span");
      backendBadge.className = "session-picker__badge";
      backendBadge.textContent = session.backend;
      item.appendChild(backendBadge);

      const nameSpan = document.createElement("span");
      nameSpan.className = "session-picker__name";
      nameSpan.textContent = session.name;
      item.appendChild(nameSpan);

      if (session.windows !== undefined) {
        const windowsSpan = document.createElement("span");
        windowsSpan.className = "session-picker__windows";
        windowsSpan.textContent = `${session.windows}w`;
        item.appendChild(windowsSpan);
      }

      item.addEventListener("click", () => {
        postMessage({
          type: "paneSwitchBackend",
          paneId: "default",
          backend: session.backend,
        });
      });

      this.listElement.appendChild(item);
    }
  }
}
