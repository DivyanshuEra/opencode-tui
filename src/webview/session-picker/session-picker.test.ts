// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../shared/vscode-api", () => ({
  postMessage: vi.fn(),
  acquireVsCodeApi: () => ({ postMessage: vi.fn() }),
}));

import { SessionPicker, type SessionInfo } from "./session-picker";
import { postMessage } from "../shared/vscode-api";

describe("SessionPicker", () => {
  let picker: SessionPicker;

  beforeEach(() => {
    vi.clearAllMocks();
    picker = new SessionPicker();
  });

  it("creates DOM element with header and list", () => {
    const el = picker.getElement();
    expect(el.className).toBe("session-picker");
    expect(el.querySelector(".session-picker__header")).toBeTruthy();
    expect(el.querySelector(".session-picker__list")).toBeTruthy();
  });

  it("shows empty message when no sessions", () => {
    picker.setSessions([]);
    const empty = picker.getElement().querySelector(".session-picker__empty");
    expect(empty?.textContent).toBe("No sessions found");
  });

  it("renders session items with badges and names", () => {
    const sessions: SessionInfo[] = [
      { id: "1", name: "work", backend: "tmux", windows: 3, attached: true },
      { id: "2", name: "dev", backend: "zellij", windows: 1 },
    ];
    picker.setSessions(sessions);

    const items = picker.getElement().querySelectorAll(".session-picker__item");
    expect(items).toHaveLength(2);
    expect(items[0].querySelector(".session-picker__badge")?.textContent).toBe("tmux");
    expect(items[0].querySelector(".session-picker__name")?.textContent).toBe("work");
    expect(items[0].classList.contains("session-picker__item--active")).toBe(true);
    expect(items[1].querySelector(".session-picker__badge")?.textContent).toBe("zellij");
  });

  it("sends paneSwitchBackend on session click", () => {
    picker.setSessions([
      { id: "1", name: "work", backend: "tmux" },
    ]);
    const item = picker.getElement().querySelector(".session-picker__item") as HTMLElement;
    item.click();
    expect(postMessage).toHaveBeenCalledWith({
      type: "paneSwitchBackend",
      paneId: "default",
      backend: "tmux",
    });
  });

  it("getSessions returns current sessions", () => {
    const sessions: SessionInfo[] = [{ id: "1", name: "test", backend: "tmux" }];
    picker.setSessions(sessions);
    expect(picker.getSessions()).toEqual(sessions);
  });
});
