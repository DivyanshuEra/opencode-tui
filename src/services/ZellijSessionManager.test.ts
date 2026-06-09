import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ZellijSessionManager,
  ZellijUnavailableError,
} from "./ZellijSessionManager";
import type { TmuxSession } from "../types";
import type { ILogger } from "./ILogger";

type MockExecStep = {
  stdout?: string;
  stderr?: string;
  error?: (Error & { code?: number | string; stderr?: string }) | null;
};

type SplitSeparator =
  | string
  | RegExp
  | { [Symbol.split](string: string, limit?: number): string[] };

describe("ZellijSessionManager", () => {
  let manager: ZellijSessionManager;
  let execCalls: Array<{ file: string; args: string[]; cwd?: string }>;
  type SplitImplementation = (
    this: string,
    separator?: SplitSeparator,
    limit?: number,
  ) => string[];

  beforeEach(() => {
    vi.clearAllMocks();
    execCalls = [];
    manager = new ZellijSessionManager();
  });

  function mockExecSequence(steps: MockExecStep[]): void {
    let callIndex = 0;
    manager = new ZellijSessionManager(undefined, (file, args, options, callback) => {
      execCalls.push({ file, args, cwd: options.cwd?.toString() });
      const step = steps[callIndex++] ?? { stdout: "", stderr: "" };
      callback(step.error ?? null, step.stdout ?? "", step.stderr ?? "");
    });
  }

  function commandError(
    message: string,
    stderr = "",
    code: number | string = 1,
  ): Error & { code: number | string; stderr: string } {
    return Object.assign(new Error(message), { code, stderr });
  }

  function loggerWithDebug(debug: (message: string) => void): ILogger {
    return {
      debug,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }

  function mockPlainThrowable(value: { name: string; message: string }): void {
    manager = new ZellijSessionManager(undefined, (_file, args, options, callback) => {
      execCalls.push({ file: "zellij", args, cwd: options.cwd?.toString() });
      callback(value, "", "");
    });
  }

  it("uses the default execFile adapter", async () => {
    vi.resetModules();
    const execFileMock = vi.fn(
      (
        _file: string,
        _args: string[],
        _options: object,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, "zellij 0.41.2", "");
      },
    );
    vi.doMock("node:child_process", () => ({ execFile: execFileMock }));
    const module = await import("./ZellijSessionManager");
    const defaultManager = new module.ZellijSessionManager();

    await expect(defaultManager.isAvailable()).resolves.toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      "zellij",
      ["--version"],
      {},
      expect.any(Function),
    );
    vi.doUnmock("node:child_process");
  });

  it("reports available when zellij version command succeeds", async () => {
    mockExecSequence([{ stdout: "zellij 0.41.2" }]);

    await expect(manager.isAvailable()).resolves.toBe(true);
    expect(execCalls[0]?.args).toEqual(["--version"]);
  });

  it("reports unavailable when zellij binary is missing", async () => {
    const missingZellijError = Object.assign(new Error("spawn zellij ENOENT"), {
      code: "ENOENT",
    });
    mockExecSequence([{ error: missingZellijError }]);

    await expect(manager.isAvailable()).resolves.toBe(false);
  });

  it("rethrows non-availability errors from version checks", async () => {
    const error = commandError("permission denied", "denied");
    mockExecSequence([{ error }]);

    await expect(manager.isAvailable()).rejects.toBe(error);
  });

  it("parses zellij sessions", async () => {
    mockExecSequence([{ stdout: "repo-a\nrepo-b (current)\n" }]);

    await expect(manager.discoverSessions()).resolves.toEqual([
      { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: false },
      { id: "repo-b", name: "repo-b", workspace: "repo-b", isActive: true },
    ]);
  });

  it("falls back to the full session line when split returns no name token", async () => {
    const originalSplit = String.prototype.split;
    const splitMock: SplitImplementation = function splitWithoutSessionName(
        this: string,
        separator?: SplitSeparator,
        limit?: number,
      ): string[] {
        if (String(this) === "repo-empty" && separator instanceof RegExp) {
          return [];
        }
        if (limit === undefined) {
          return originalSplit.call(this, separator);
        }
        return originalSplit.call(this, separator, limit);
      };
    const splitSpy = vi.spyOn(String.prototype, "split").mockImplementation(splitMock);
    mockExecSequence([{ stdout: "repo-empty\n" }]);

    try {
      await expect(manager.discoverSessions()).resolves.toEqual([
        { id: "repo-empty", name: "repo-empty", workspace: "repo-empty", isActive: false },
      ]);
    } finally {
      splitSpy.mockRestore();
    }
  });

  it("falls back to the original session line when the first token is empty", async () => {
    const originalSplit = String.prototype.split;
    const splitMock: SplitImplementation = function splitWithEmptySessionToken(
        this: string,
        separator?: SplitSeparator,
        limit?: number,
      ): string[] {
        if (String(this) === "repo-a" && separator instanceof RegExp) {
          return [];
        }
        if (limit === undefined) {
          return originalSplit.call(this, separator);
        }
        return originalSplit.call(this, separator, limit);
      };
    const splitSpy = vi.spyOn(String.prototype, "split").mockImplementation(splitMock);
    mockExecSequence([{ stdout: "repo-a\n" }]);

    await expect(manager.discoverSessions()).resolves.toEqual([
      { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: false },
    ]);
    splitSpy.mockRestore();
  });

  it("returns no discovered sessions for empty-session errors", async () => {
    mockExecSequence([{ error: commandError("failed", "no sessions found") }]);

    await expect(manager.discoverSessions()).resolves.toEqual([]);
  });

  it("wraps missing zellij errors while discovering sessions", async () => {
    mockExecSequence([
      { error: commandError("spawn zellij ENOENT", "", "ENOENT") },
    ]);

    await expect(manager.discoverSessions()).rejects.toThrow(
      ZellijUnavailableError,
    );
  });

  it("rethrows discovery errors that are not availability or no-session failures", async () => {
    const error = commandError("boom", "bad output");
    mockExecSequence([{ error }]);

    await expect(manager.discoverSessions()).rejects.toBe(error);
  });

  it("marks an existing ensured session active without creating it", async () => {
    mockExecSequence([{ stdout: "repo-a\nrepo-b [current]\n" }]);

    await expect(
      manager.ensureSession("repo-a", "/workspace/repo-a"),
    ).resolves.toEqual({
      action: "attached",
      session: {
        id: "repo-a",
        name: "repo-a",
        workspace: "repo-a",
        isActive: true,
      },
    });
    expect(execCalls).toHaveLength(1);
  });

  it("creates with the next collision-safe suffix when discovered ids change between checks", async () => {
    const created: Array<{ name: string; workspacePath: string }> = [];
    let idReads = 0;
    const shiftingSession: TmuxSession = {
      get id() {
        idReads += 1;
        return idReads === 1 ? "other" : "repo-a";
      },
      name: "repo-a",
      workspace: "repo-a",
      isActive: false,
    };
    class CollisionManager extends ZellijSessionManager {
      public override async discoverSessions(): Promise<TmuxSession[]> {
        return [
          shiftingSession,
          { id: "repo-a-2", name: "repo-a-2", workspace: "repo-a-2", isActive: false },
        ];
      }

      public override async createSession(
        name: string,
        workspacePath: string,
      ): Promise<void> {
        created.push({ name, workspacePath });
      }
    }
    manager = new CollisionManager();

    await expect(
      manager.ensureSession("repo-a", "/workspace"),
    ).resolves.toMatchObject({
      action: "created",
      session: { id: "repo-a-3", workspace: "workspace" },
    });
    expect(created).toEqual([{ name: "repo-a-3", workspacePath: "/workspace" }]);
  });

  it("uses session name as workspace when basename is empty", async () => {
    mockExecSequence([{ stdout: "" }, { stdout: "" }]);

    await expect(manager.ensureSession("root", "/")).resolves.toMatchObject({
      session: { workspace: "root" },
    });
  });

  it("wraps missing zellij errors while creating sessions", async () => {
    mockExecSequence([
      { error: commandError("spawn zellij ENOENT", "", "ENOENT") },
    ]);

    await expect(manager.createSession("repo", "/tmp/repo")).rejects.toThrow(
      ZellijUnavailableError,
    );
  });

  it("rethrows create-session failures that are not missing zellij", async () => {
    const error = commandError("create failed", "permission denied");
    mockExecSequence([{ error }]);

    await expect(manager.createSession("repo", "/tmp/repo")).rejects.toBe(
      error,
    );
  });

  it("creates missing sessions with create-background attach", async () => {
    mockExecSequence([{ stdout: "" }, { stdout: "" }]);

    await expect(
      manager.ensureSession("repo-a", "/workspace/repo-a"),
    ).resolves.toMatchObject({
      action: "created",
      session: { id: "repo-a" },
    });

    expect(execCalls[1]?.args).toEqual([
      "attach",
      "--create-background",
      "repo-a",
    ]);
    expect(execCalls[1]?.cwd).toBe("/workspace/repo-a");
  });

  it("builds attach command", () => {
    expect(manager.getAttachCommand("repo-a")).toBe("zellij attach 'repo-a'");
  });

  it("shell-quotes single quotes in attach commands", () => {
    expect(manager.getAttachCommand("repo's app")).toBe(
      "zellij attach 'repo'\\''s app'",
    );
  });

  it("kills a named session", async () => {
    mockExecSequence([{ stdout: "" }]);

    await expect(manager.killSession("repo-a")).resolves.toBeUndefined();

    expect(execCalls[0]?.args).toEqual(["kill-session", "repo-a"]);
  });

  it("switches sessions by name", async () => {
    mockExecSequence([{ stdout: "" }]);

    await expect(manager.switchSession("repo-b")).resolves.toBeUndefined();

    expect(execCalls[0]?.args).toEqual(["action", "switch-session", "repo-b"]);
  });

  it("splits panes horizontally and returns the new pane id", async () => {
    mockExecSequence([{ stdout: "terminal_7\n" }]);

    await expect(
      manager.splitPane("h", {
        command: "npm test",
        workingDirectory: "/workspace/repo-a",
      }),
    ).resolves.toBe("terminal_7");

    expect(execCalls[0]).toEqual({
      file: "zellij",
      args: [
        "action",
        "new-pane",
        "--direction",
        "right",
        "--cwd",
        "/workspace/repo-a",
        "--command",
        "npm test",
      ],
      cwd: "/workspace/repo-a",
    });
  });

  it("splits panes vertically", async () => {
    mockExecSequence([{ stdout: "plugin_2\n" }]);

    await expect(manager.splitPane("v")).resolves.toBe("plugin_2");

    expect(execCalls[0]?.args).toEqual([
      "action",
      "new-pane",
      "--direction",
      "down",
    ]);
  });

  it("throws when split pane output has no pane id", async () => {
    mockExecSequence([{ stdout: "" }]);

    await expect(manager.splitPane("h")).rejects.toThrow(
      "Failed to get pane ID",
    );
  });

  it("closes, focuses, resizes, and zooms panes", async () => {
    mockExecSequence([
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
    ]);

    await manager.killPane();
    await manager.selectPane("terminal_1");
    await manager.resizePane("left", 5);
    await manager.zoomPane();

    expect(execCalls.map((call) => call.args)).toEqual([
      ["action", "close-pane"],
      ["action", "focus-pane-id", "terminal_1"],
      ["action", "resize", "--left", "+5"],
      ["action", "toggle-fullscreen"],
    ]);
  });

  it("formats negative resize adjustments", async () => {
    mockExecSequence([{ stdout: "" }]);

    await manager.resizePane("up", -3);

    expect(execCalls[0]?.args).toEqual(["action", "resize", "--up", "-3"]);
  });

  it("rethrows original failures from every imperative command wrapper", async () => {
    const errors = Array.from({ length: 15 }, (_, index) =>
      commandError(`failure ${index}`, "not a no-session error"),
    );
    mockExecSequence(errors.map((error) => ({ error })));

    await expect(manager.killSession("repo")).rejects.toBe(errors[0]);
    await expect(manager.switchSession("repo")).rejects.toBe(errors[1]);
    await expect(manager.splitPane("h")).rejects.toBe(errors[2]);
    await expect(manager.killPane()).rejects.toBe(errors[3]);
    await expect(manager.selectPane("terminal_1")).rejects.toBe(errors[4]);
    await expect(manager.resizePane("right", 1)).rejects.toBe(errors[5]);
    await expect(manager.zoomPane()).rejects.toBe(errors[6]);
    await expect(manager.sendTextToPane("text")).rejects.toBe(errors[7]);
    await expect(manager.createTab()).rejects.toBe(errors[8]);
    await expect(manager.nextTab()).rejects.toBe(errors[9]);
    await expect(manager.prevTab()).rejects.toBe(errors[10]);
    await expect(manager.killTab()).rejects.toBe(errors[11]);
    await expect(manager.selectTab(1)).rejects.toBe(errors[12]);
    await expect(manager.renameTab("main")).rejects.toBe(errors[13]);
    await expect(manager.listTabs()).rejects.toBe(errors[14]);
  });

  it("wraps missing zellij failures from command wrappers", async () => {
    const error = commandError("spawn zellij", "ENOENT: missing zellij");
    mockExecSequence([{ error }]);

    await expect(manager.killPane()).rejects.toThrow(ZellijUnavailableError);
    expect(new ZellijUnavailableError().message).toBe("zellij is not installed");
    expect(new ZellijUnavailableError("custom").name).toBe(
      "ZellijUnavailableError",
    );
  });

  it("sends text and optionally submits Enter", async () => {
    mockExecSequence([{ stdout: "" }, { stdout: "" }, { stdout: "" }]);

    await manager.sendTextToPane("hello");
    await manager.sendTextToPane("run", { submit: true });

    expect(execCalls.map((call) => call.args)).toEqual([
      ["action", "write-chars", "hello"],
      ["action", "write-chars", "run"],
      ["action", "send-keys", "Enter"],
    ]);
  });

  it("parses tab-separated pane output", async () => {
    mockExecSequence([
      {
        stdout:
          "terminal_1\nterminal_2\tserver\tfocused=true\tfloating=true\nplugin_3\tlogs\tfocused=false\n",
      },
    ]);

    await expect(manager.listPanes()).resolves.toEqual([
      { id: "terminal_1", title: "", isFocused: false, isFloating: false },
      { id: "terminal_2", title: "server", isFocused: true, isFloating: true },
      { id: "plugin_3", title: "logs", isFocused: false, isFloating: false },
    ]);
  });

  it("parses blank tab-separated pane titles", async () => {
    mockExecSequence([{ stdout: "terminal_6\t\tcurrent\n" }]);

    await expect(manager.listPanes()).resolves.toEqual([
      { id: "terminal_6", title: "", isFocused: true, isFloating: false },
    ]);
  });

  it("parses JSON pane output", async () => {
    mockExecSequence([
      {
        stdout: JSON.stringify([
          { id: "terminal_1", title: "shell", is_focused: true },
          { id: "plugin_2", name: "status", is_floating: true },
        ]),
      },
    ]);

    await expect(manager.listPanes()).resolves.toEqual([
      { id: "terminal_1", title: "shell", isFocused: true, isFloating: false },
      { id: "plugin_2", title: "status", isFocused: false, isFloating: true },
    ]);
  });

  it("parses JSON panes with fallback titles and boolean keys", async () => {
    mockExecSequence([
      {
        stdout: JSON.stringify([
          { id: "terminal_6", is_focused: false, isFloating: "yes" },
        ]),
      },
    ]);

    await expect(manager.listPanes()).resolves.toEqual([
      { id: "terminal_6", title: "", isFocused: false, isFloating: true },
    ]);
  });

  it("parses permissive JSON pane shapes and skips invalid entries", async () => {
    mockExecSequence([
      {
        stdout: JSON.stringify([
          null,
          ["terminal_9"],
          { id: 4, pane_title: "numeric", focused: "yes", floating: "0" },
          { title: "embedded", text: "pane terminal_5 is active" },
          { id: "missing-id" },
        ]),
      },
    ]);

    await expect(manager.listPanes()).resolves.toEqual([
      { id: "terminal_4", title: "numeric", isFocused: true, isFloating: false },
      { id: "terminal_5", title: "embedded", isFocused: false, isFloating: false },
    ]);
  });

  it("parses named pane values from text output and skips unidentifiable lines", async () => {
    mockExecSequence([
      {
        stdout:
          "garbage\nterminal_8 title=api active is_floating=true\nplugin_9 name: status current\n",
      },
    ]);

    await expect(manager.listPanes()).resolves.toEqual([
      { id: "terminal_8", title: "api active is_floating=true", isFocused: true, isFloating: true },
      { id: "plugin_9", title: "status current", isFocused: true, isFloating: false },
    ]);
  });

  it("falls back to an empty title when a tab-split pane title is missing", async () => {
    const originalSplit = String.prototype.split;
    const splitMock: SplitImplementation = function splitWithSparsePaneTitle(
        this: string,
        separator?: SplitSeparator,
        limit?: number,
      ): string[] {
        if (String(this) === "terminal_10" && separator === "\t") {
          const sparseParts = ["terminal_10"];
          sparseParts.length = 2;
          return sparseParts;
        }
        if (limit === undefined) {
          return originalSplit.call(this, separator);
        }
        return originalSplit.call(this, separator, limit);
      };
    const splitSpy = vi.spyOn(String.prototype, "split").mockImplementation(splitMock);
    mockExecSequence([{ stdout: "terminal_10\n" }]);

    await expect(manager.listPanes()).resolves.toEqual([
      { id: "terminal_10", title: "", isFocused: false, isFloating: false },
    ]);
    splitSpy.mockRestore();
  });

  it("leaves pane title empty when named values are empty", async () => {
    mockExecSequence([{ stdout: "terminal_10 title=]\n" }]);

    await expect(manager.listPanes()).resolves.toEqual([
      { id: "terminal_10", title: "", isFocused: false, isFloating: false },
    ]);
  });

  it("returns empty panes for no-session errors", async () => {
    const error = Object.assign(new Error("command failed"), {
      code: 1,
      stderr: "There is no active session!",
    });
    mockExecSequence([{ error }]);

    await expect(manager.listPanes()).resolves.toEqual([]);
  });

  it("rethrows list-pane failures that are not no-session errors", async () => {
    const error = commandError("list panes failed", "parse failure");
    mockExecSequence([{ error }]);

    await expect(manager.listPanes()).rejects.toBe(error);
  });

  it("rethrows plain throwable objects from no-session checked commands", async () => {
    const plainThrowable = { name: "PlainThrowable", message: "plain failure" };
    mockPlainThrowable(plainThrowable);

    await expect(manager.listPanes()).rejects.toBe(plainThrowable);
  });

  it("uses an empty stderr fallback when checking no-session errors", async () => {
    const error = commandError("ordinary failure", undefined, 1);
    mockExecSequence([{ error }]);

    await expect(manager.listPanes()).rejects.toBe(error);
  });

  it("detects no-session errors from the message when stderr is absent", async () => {
    const isNoSessionsError = Reflect.get(
      Object.getPrototypeOf(manager),
      "isNoSessionsError",
    ) as (this: ZellijSessionManager, error: unknown) => boolean;
    const messageOnlyError = new Error("no active sessions");
    Object.defineProperty(messageOnlyError, "stderr", { value: undefined });

    expect(Reflect.apply(isNoSessionsError, manager, [new Error("ordinary failure")])).toBe(false);
    expect(Reflect.apply(isNoSessionsError, manager, [messageOnlyError])).toBe(true);

    mockExecSequence([{ error: messageOnlyError }]);

    await expect(manager.listPanes()).resolves.toEqual([]);
  });

  it("rethrows plain throwable objects from availability-checked commands", async () => {
    const plainThrowable = { name: "PlainThrowable", message: "plain failure" };
    mockPlainThrowable(plainThrowable);

    await expect(manager.killPane()).rejects.toBe(plainThrowable);
  });

  it("creates and navigates tabs", async () => {
    mockExecSequence([
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
    ]);

    await manager.createTab({ name: "tests", workingDirectory: "/tmp/repo" });
    await manager.nextTab();
    await manager.prevTab();
    await manager.killTab();
    await manager.selectTab(2);
    await manager.renameTab("server");

    expect(execCalls.map((call) => call.args)).toEqual([
      ["action", "new-tab", "--name", "tests", "--cwd", "/tmp/repo"],
      ["action", "go-to-next-tab"],
      ["action", "go-to-previous-tab"],
      ["action", "close-tab"],
      ["action", "go-to-tab", "2"],
      ["action", "rename-tab", "server"],
    ]);
    expect(execCalls[0]?.cwd).toBe("/tmp/repo");
  });

  it("creates a tab without optional arguments", async () => {
    mockExecSequence([{ stdout: "" }]);

    await expect(manager.createTab()).resolves.toBeUndefined();

    expect(execCalls[0]).toEqual({
      file: "zellij",
      args: ["action", "new-tab"],
      cwd: undefined,
    });
  });

  it("parses zellij action list-tabs columnar output", async () => {
    // Real zellij 0.44.1 output: 'TAB_ID  POSITION  NAME'
    mockExecSequence([
      {
        stdout: "TAB_ID  POSITION  NAME\n0  0  main\n1  1  tests\n",
      },
    ]);

    // POSITION 0 → display index 1, POSITION 1 → display index 2
    await expect(manager.listTabs()).resolves.toEqual([
      { index: 1, name: "main", isActive: false },
      { index: 2, name: "tests", isActive: false },
    ]);
  });

  it("parses columnar tab output with id fallback and active tokens", async () => {
    mockExecSequence([
      {
        stdout: "5  nope  ops  current\nabc  def  misc  inactive\n",
      },
    ]);

    await expect(manager.listTabs()).resolves.toEqual([
      { index: 6, name: "ops", isActive: true },
      { index: 2, name: "misc", isActive: false },
    ]);
  });

  it("falls back to a generated columnar tab name when the parsed name is missing", async () => {
    const originalFilter = Array.prototype.filter;
    const filterSpy = vi.spyOn(Array.prototype, "filter").mockImplementation(
      function filterWithSparseTabName<T>(
        this: T[],
        predicate: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T[] {
        if (
          this.length === 3 &&
          this[0] === "0" &&
          this[1] === "0" &&
          this[2] === "missing" &&
          predicate === Boolean
        ) {
          const sparseParts = [this[0], this[1]];
          sparseParts.length = 3;
          return sparseParts;
        }
        return originalFilter.call(this, predicate, thisArg);
      },
    );
    mockExecSequence([{ stdout: "0  0  missing\n" }]);

    try {
      await expect(manager.listTabs()).resolves.toEqual([
        { index: 1, name: "Tab 1", isActive: false },
      ]);
    } finally {
      filterSpy.mockRestore();
    }
  });

  it("parses human-readable tab output", async () => {
    mockExecSequence([{ stdout: "1: main (active)\n2: tests\n" }]);

    await expect(manager.listTabs()).resolves.toEqual([
      { index: 1, name: "main", isActive: true },
      { index: 2, name: "tests", isActive: false },
    ]);
  });

  it("parses human tab output without numbers and derives fallback names", async () => {
    mockExecSequence([{ stdout: "* focused\n{}\n" }]);

    await expect(manager.listTabs()).resolves.toEqual([
      { index: 1, name: "Tab 1", isActive: true },
      { index: 2, name: "Tab 2", isActive: false },
    ]);
  });

  it("parses JSON tab output", async () => {
    mockExecSequence([
      {
        stdout: JSON.stringify([
          { index: 1, name: "main", active: true },
          { index: 2, title: "logs", is_active: false },
        ]),
      },
    ]);

    await expect(manager.listTabs()).resolves.toEqual([
      { index: 1, name: "main", isActive: true },
      { index: 2, name: "logs", isActive: false },
    ]);
  });

  it("parses permissive JSON tab shapes and skips non-record entries", async () => {
    mockExecSequence([
      {
        stdout: JSON.stringify([
          "bad",
          { position: 4, tab_name: "api", focused: "focused" },
          { tab_index: "not numeric", isActive: true },
        ]),
      },
    ]);

    await expect(manager.listTabs()).resolves.toEqual([
      { index: 4, name: "api", isActive: true },
      { index: 3, name: "Tab 3", isActive: true },
    ]);
  });

  it("returns empty tabs for no-session errors", async () => {
    mockExecSequence([{ error: commandError("no active sessions") }]);

    await expect(manager.listTabs()).resolves.toEqual([]);
  });

  it("detects no-session tab errors from message when stderr is absent", async () => {
    const error = new Error("no sessions");
    mockExecSequence([{ error }]);

    await expect(manager.listTabs()).resolves.toEqual([]);
  });

  it("falls back to text parsing and logs malformed JSON", async () => {
    const debug = vi.fn();
    manager = new ZellijSessionManager(loggerWithDebug(debug), (file, args, options, callback) => {
      execCalls.push({ file, args, cwd: options.cwd?.toString() });
      callback(null, "[{broken json", "");
    });

    await expect(manager.listTabs()).resolves.toEqual([
      { index: 1, name: "broken json", isActive: false },
    ]);
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("tryParseJson failed"),
    );
  });

  it("logs non-Error malformed JSON failures as strings", async () => {
    const debug = vi.fn();
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation(() => {
      throw "string parse failure";
    });
    manager = new ZellijSessionManager(loggerWithDebug(debug), (file, args, options, callback) => {
      execCalls.push({ file, args, cwd: options.cwd?.toString() });
      callback(null, "[1]", "");
    });

    await expect(manager.listTabs()).resolves.toEqual([
      { index: 1, name: "1", isActive: false },
    ]);
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("tryParseJson failed: string parse failure"),
    );
    parseSpy.mockRestore();
  });

  it("logs non-Error malformed JSON parse failures", async () => {
    const debug = vi.fn();
    const originalParse = JSON.parse;
    vi.spyOn(JSON, "parse").mockImplementation(() => {
      throw "bad json token";
    });
    manager = new ZellijSessionManager(loggerWithDebug(debug), (file, args, options, callback) => {
      execCalls.push({ file, args, cwd: options.cwd?.toString() });
      callback(null, "[1]", "");
    });

    await expect(manager.listTabs()).resolves.toEqual([
      { index: 1, name: "1", isActive: false },
    ]);
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("tryParseJson failed: bad json token"),
    );
    expect(JSON.parse).not.toBe(originalParse);
  });

  it("returns active focus from current tab info and focused pane", async () => {
    mockExecSequence([
      { stdout: "name: main\n" },
      { stdout: "terminal_1\tone\nterminal_2\ttwo\tfocused=true\n" },
    ]);

    await expect(manager.getActiveFocus()).resolves.toEqual({
      tabName: "main",
      paneId: "terminal_2",
    });
  });

  it("returns active focus from JSON tab info", async () => {
    mockExecSequence([
      { stdout: JSON.stringify({ title: "json-tab" }) },
      { stdout: JSON.stringify([{ id: 2, name: "shell", isFocused: true }]) },
    ]);

    await expect(manager.getActiveFocus()).resolves.toEqual({
      tabName: "json-tab",
      paneId: "terminal_2",
    });
  });

  it("returns undefined active focus when no focused pane exists", async () => {
    mockExecSequence([{ stdout: "name: main\n" }, { stdout: "terminal_1\tone\n" }]);

    await expect(manager.getActiveFocus()).resolves.toBeUndefined();
  });

  it("returns undefined active focus when the tab name is empty", async () => {
    mockExecSequence([{ stdout: "" }, { stdout: "terminal_1\tone\tfocused=true\n" }]);

    await expect(manager.getActiveFocus()).resolves.toBeUndefined();
  });

  it("logs and suppresses active-focus failures", async () => {
    const debug = vi.fn();
    manager = new ZellijSessionManager(loggerWithDebug(debug), (_file, _args, _options, callback) => {
      callback(commandError("focus failed"), "", "focus failed");
    });

    await expect(manager.getActiveFocus()).resolves.toBeUndefined();
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("getActiveFocus failed: focus failed"),
    );
  });

  it("logs string active-focus failures", async () => {
    const debug = vi.fn();
    manager = new ZellijSessionManager(loggerWithDebug(debug), () => {
      throw "plain focus failure";
    });

    await expect(manager.getActiveFocus()).resolves.toBeUndefined();
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("getActiveFocus failed: plain focus failure"),
    );
  });

  it("dumps focused pane screen content", async () => {
    mockExecSequence([{ stdout: "\u001b[31mscreen\u001b[0m\ncontent\n" }]);

    await expect(manager.dumpScreen()).resolves.toBe("screen\ncontent\n");
    expect(execCalls[0]?.args).toEqual([
      "action",
      "dump-screen",
    ]);
  });

  it("returns an empty screen for no-session dump errors", async () => {
    const error = Object.assign(new Error("no sessions"), { code: 1 });
    mockExecSequence([{ error }]);

    await expect(manager.dumpScreen()).resolves.toBe("");
  });

  it("wraps missing zellij errors while dumping the screen", async () => {
    mockExecSequence([
      { error: commandError("spawn zellij ENOENT", "", "ENOENT") },
    ]);

    await expect(manager.dumpScreen()).rejects.toThrow(ZellijUnavailableError);
  });

  it("rethrows dump-screen failures that are not missing zellij or no-session", async () => {
    const error = commandError("dump failed", "permission denied");
    mockExecSequence([{ error }]);

    await expect(manager.dumpScreen()).rejects.toBe(error);
  });

  describe("--session flag injection", () => {
    it("prepends --session <name> for action commands when activeSessionName is set", async () => {
      mockExecSequence([{ stdout: "" }]);
      manager.setActiveSessionName("my-session");

      await manager.switchSession("other-session");

      expect(execCalls[0]?.args).toEqual([
        "--session", "my-session",
        "action", "switch-session", "other-session",
      ]);
    });

    it("does not prepend --session for non-action commands", async () => {
      mockExecSequence([{ stdout: "" }]);
      manager.setActiveSessionName("my-session");

      await manager.killSession("my-session");

      expect(execCalls[0]?.args).toEqual(["kill-session", "my-session"]);
    });

    it("does not prepend --session when activeSessionName is not set", async () => {
      mockExecSequence([{ stdout: "" }]);

      await manager.switchSession("repo-b");

      expect(execCalls[0]?.args).toEqual(["action", "switch-session", "repo-b"]);
    });
  });
});
