import type { TerminalBackendType } from "../../types";
import { postMessage } from "../shared/vscode-api";

export class BackendSelector {
  private readonly element: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private readonly dropdown: HTMLSelectElement;
  private currentBackend: TerminalBackendType = "native";
  private availableBackends: TerminalBackendType[] = ["native"];
  private paneId: string = "default";

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "backend-selector";

    this.label = document.createElement("span");
    this.label.className = "backend-selector__label";
    this.element.appendChild(this.label);

    this.dropdown = document.createElement("select");
    this.dropdown.className = "backend-selector__dropdown";
    this.dropdown.addEventListener("change", () => {
      const value = this.dropdown.value as TerminalBackendType;
      if (value !== this.currentBackend) {
        postMessage({
          type: "paneSwitchBackend",
          paneId: this.paneId,
          backend: value,
        });
      }
    });
    this.element.appendChild(this.dropdown);

    this.updateDisplay();
  }

  getElement(): HTMLDivElement {
    return this.element;
  }

  setPaneId(paneId: string): void {
    this.paneId = paneId;
  }

  setBackend(backend: TerminalBackendType): void {
    this.currentBackend = backend;
    this.updateDisplay();
  }

  setAvailableBackends(backends: TerminalBackendType[]): void {
    this.availableBackends = backends;
    this.updateDisplay();
  }

  getBackend(): TerminalBackendType {
    return this.currentBackend;
  }

  private updateDisplay(): void {
    const backendLabels: Record<TerminalBackendType, string> = {
      native: "Shell",
      tmux: "tmux",
      zellij: "zellij",
    };
    this.label.textContent = backendLabels[this.currentBackend] ?? this.currentBackend;

    this.dropdown.innerHTML = "";
    const allBackends: TerminalBackendType[] = ["native", "tmux", "zellij"];
    for (const backend of allBackends) {
      const option = document.createElement("option");
      option.value = backend;
      option.textContent = backendLabels[backend];
      option.selected = backend === this.currentBackend;
      if (!this.availableBackends.includes(backend)) {
        option.disabled = true;
      }
      this.dropdown.appendChild(option);
    }
  }
}
