import { describe, it, expect, beforeEach, vi } from "vitest";
import { ContextSharingService, Context } from "./ContextSharingService";
import { FileReferenceManager } from "./FileReferenceManager";
import type * as vscodeTypes from "../test/mocks/vscode";

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

describe("ContextSharingService", () => {
  let service: ContextSharingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ContextSharingService();
  });

  describe("getCurrentContext", () => {
    it("should return null when no editor is active", () => {
      vscode.window.activeTextEditor = undefined;

      const result = service.getCurrentContext();

      expect(result).toBeNull();
    });

    it("should return context with file path only when no selection", () => {
      const document = new vscode.TextDocument(
        { fsPath: "/workspace/src/file.ts", path: "/workspace/src/file.ts" },
        "content",
      );
      const selection = new vscode.Selection(0, 0, 0, 0);
      vscode.window.activeTextEditor = new vscode.TextEditor(
        document,
        selection,
      );

      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/file.ts");

      const result = service.getCurrentContext();

      expect(result).toEqual({
        filePath: "src/file.ts",
      });
      expect(result?.selectionStart).toBeUndefined();
      expect(result?.selectionEnd).toBeUndefined();
    });

    it("should return context with selection for single line selection", () => {
      const document = new vscode.TextDocument(
        { fsPath: "/workspace/src/file.ts", path: "/workspace/src/file.ts" },
        "line1\nline2\nline3",
      );
      const selection = new vscode.Selection(2, 0, 2, 5);
      vscode.window.activeTextEditor = new vscode.TextEditor(
        document,
        selection,
      );

      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/file.ts");

      const result = service.getCurrentContext();

      expect(result).toEqual({
        filePath: "src/file.ts",
        selectionStart: 3,
        selectionEnd: 3,
      });
    });

    it("should return context with selection for multi-line selection", () => {
      const document = new vscode.TextDocument(
        { fsPath: "/workspace/src/file.ts", path: "/workspace/src/file.ts" },
        "line1\nline2\nline3\nline4",
      );
      const selection = new vscode.Selection(1, 0, 3, 5);
      vscode.window.activeTextEditor = new vscode.TextEditor(
        document,
        selection,
      );

      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/file.ts");

      const result = service.getCurrentContext();

      expect(result).toEqual({
        filePath: "src/file.ts",
        selectionStart: 2,
        selectionEnd: 4,
      });
    });

    it("should handle reverse selection (end before start)", () => {
      const document = new vscode.TextDocument(
        { fsPath: "/workspace/src/file.ts", path: "/workspace/src/file.ts" },
        "line1\nline2\nline3\nline4",
      );
      const selection = new vscode.Selection(3, 5, 1, 0);
      vscode.window.activeTextEditor = new vscode.TextEditor(
        document,
        selection,
      );

      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/file.ts");

      const result = service.getCurrentContext();

      expect(result).toEqual({
        filePath: "src/file.ts",
        selectionStart: 2,
        selectionEnd: 4,
      });
    });
  });

  describe("formatFileRef", () => {
    it("should format URI as file reference", () => {
      const uri = {
        fsPath: "/workspace/src/file.ts",
        path: "/workspace/src/file.ts",
      };

      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/file.ts");

      const result = service.formatFileRef(uri as any);

      expect(result).toBe("@src/file.ts");
      expect(vscode.workspace.asRelativePath).toHaveBeenCalledWith(uri, false);
    });

    it("should format nested path correctly", () => {
      const uri = {
        fsPath: "/workspace/src/deep/nested/file.ts",
        path: "/workspace/src/deep/nested/file.ts",
      };

      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue(
        "src/deep/nested/file.ts",
      );

      const result = service.formatFileRef(uri as any);

      expect(result).toBe("@src/deep/nested/file.ts");
    });
  });

  describe("formatFileRefWithLineNumbers", () => {
    it("should format file reference without line numbers when no selection", () => {
      const document = new vscode.TextDocument(
        { fsPath: "/workspace/src/file.ts", path: "/workspace/src/file.ts" },
        "content",
      );
      const selection = new vscode.Selection(0, 0, 0, 0);
      const editor = new vscode.TextEditor(document, selection);

      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/file.ts");

      const result = service.formatFileRefWithLineNumbers(editor);

      expect(result).toBe("@src/file.ts");
    });

    it("should format file reference with single line number for single line selection", () => {
      const document = new vscode.TextDocument(
        { fsPath: "/workspace/src/file.ts", path: "/workspace/src/file.ts" },
        "content",
      );
      const selection = new vscode.Selection(9, 0, 9, 5);
      const editor = new vscode.TextEditor(document, selection);

      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/file.ts");

      const result = service.formatFileRefWithLineNumbers(editor);

      expect(result).toBe("@src/file.ts#L10");
    });

    it("should format file reference with line range for multi-line selection", () => {
      const document = new vscode.TextDocument(
        { fsPath: "/workspace/src/file.ts", path: "/workspace/src/file.ts" },
        "content",
      );
      const selection = new vscode.Selection(4, 0, 9, 5);
      const editor = new vscode.TextEditor(document, selection);

      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/file.ts");

      const result = service.formatFileRefWithLineNumbers(editor);

      expect(result).toBe("@src/file.ts#L5-L10");
    });
  });

  describe("formatContext", () => {
    it("should format context without selection", () => {
      const context: Context = {
        filePath: "src/file.ts",
      };

      const result = service.formatContext(context);

      expect(result).toBe("@src/file.ts");
    });

    it("should format context with single line selection", () => {
      const context: Context = {
        filePath: "src/file.ts",
        selectionStart: 10,
        selectionEnd: 10,
      };

      const result = service.formatContext(context);

      expect(result).toBe("@src/file.ts#L10");
    });

    it("should format context with multi-line selection", () => {
      const context: Context = {
        filePath: "src/file.ts",
        selectionStart: 5,
        selectionEnd: 10,
      };

      const result = service.formatContext(context);

      expect(result).toBe("@src/file.ts#L5-L10");
    });

    it("should format context with nested path", () => {
      const context: Context = {
        filePath: "src/deep/nested/component.tsx",
        selectionStart: 1,
        selectionEnd: 50,
      };

      const result = service.formatContext(context);

      expect(result).toBe("@src/deep/nested/component.tsx#L1-L50");
    });
  });

  describe("managed file references", () => {
    it("does nothing when adding current context without a manager", () => {
      const document = new vscode.TextDocument(
        { fsPath: "/workspace/src/file.ts", path: "/workspace/src/file.ts" },
        "content",
      );
      vscode.window.activeTextEditor = new vscode.TextEditor(
        document,
        new vscode.Selection(0, 0, 0, 0),
      );

      expect(() => service.addCurrentContextToManager()).not.toThrow();
      expect(service.formatAllManagedRefs()).toBe("");
    });

    it("does nothing when a manager exists but no editor context is active", () => {
      const manager = new FileReferenceManager();
      const managedService = new ContextSharingService(manager);
      vscode.window.activeTextEditor = undefined;

      managedService.addCurrentContextToManager();

      expect(manager.getReferences()).toEqual([]);
      expect(managedService.formatAllManagedRefs()).toBe("");
    });

    it("adds the current selected context to the manager and serializes it", () => {
      const manager = new FileReferenceManager();
      const managedService = new ContextSharingService(manager);
      const document = new vscode.TextDocument(
        { fsPath: "/workspace/src/managed.ts", path: "/workspace/src/managed.ts" },
        "line1\nline2\nline3",
      );
      vscode.window.activeTextEditor = new vscode.TextEditor(
        document,
        new vscode.Selection(1, 0, 2, 5),
      );
      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue(
        "src/managed.ts",
      );

      managedService.addCurrentContextToManager();

      expect(manager.getReferences()).toMatchObject([
        { path: "src/managed.ts", lineStart: 2, lineEnd: 3 },
      ]);
      expect(managedService.formatAllManagedRefs()).toBe(
        "@src/managed.ts#L2-3",
      );
    });
  });
});
