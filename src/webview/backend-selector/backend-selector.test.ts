// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../shared/vscode-api", () => ({
  postMessage: vi.fn(),
  acquireVsCodeApi: () => ({ postMessage: vi.fn() }),
}));

import { BackendSelector } from "./backend-selector";
import { postMessage } from "../shared/vscode-api";

describe("BackendSelector", () => {
  let selector: BackendSelector;

  beforeEach(() => {
    vi.clearAllMocks();
    selector = new BackendSelector();
  });

  it("creates DOM element with label and dropdown", () => {
    const el = selector.getElement();
    expect(el.className).toBe("backend-selector");
    expect(el.querySelector(".backend-selector__label")).toBeTruthy();
    expect(el.querySelector(".backend-selector__dropdown")).toBeTruthy();
  });

  it("defaults to native backend", () => {
    expect(selector.getBackend()).toBe("native");
  });

  it("updates label when backend changes", () => {
    selector.setBackend("tmux");
    expect(selector.getBackend()).toBe("tmux");
    const label = selector.getElement().querySelector(".backend-selector__label");
    expect(label?.textContent).toBe("tmux");
  });

  it("shows zellij label for zellij backend", () => {
    selector.setBackend("zellij");
    const label = selector.getElement().querySelector(".backend-selector__label");
    expect(label?.textContent).toBe("zellij");
  });

  it("disables unavailable backends in dropdown", () => {
    selector.setAvailableBackends(["native"]);
    const dropdown = selector.getElement().querySelector(".backend-selector__dropdown") as HTMLSelectElement;
    const options = Array.from(dropdown.options);
    const tmuxOption = options.find((o) => o.value === "tmux");
    const nativeOption = options.find((o) => o.value === "native");
    expect(tmuxOption?.disabled).toBe(true);
    expect(nativeOption?.disabled).toBe(false);
  });

  it("sends paneSwitchBackend message when dropdown changes", () => {
    selector.setPaneId("pane-1");
    selector.setAvailableBackends(["native", "tmux"]);
    const dropdown = selector.getElement().querySelector(".backend-selector__dropdown") as HTMLSelectElement;
    dropdown.value = "tmux";
    dropdown.dispatchEvent(new Event("change"));
    expect(postMessage).toHaveBeenCalledWith({
      type: "paneSwitchBackend",
      paneId: "pane-1",
      backend: "tmux",
    });
  });

  it("does not send message when selecting same backend", () => {
    selector.setPaneId("pane-1");
    selector.setBackend("native");
    selector.setAvailableBackends(["native", "tmux"]);
    const dropdown = selector.getElement().querySelector(".backend-selector__dropdown") as HTMLSelectElement;
    dropdown.value = "native";
    dropdown.dispatchEvent(new Event("change"));
    expect(postMessage).not.toHaveBeenCalled();
  });
});
