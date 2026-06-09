import { describe, it, expect } from "vitest";
import * as vscode from "vscode";
import { formatDiagnostic, formatDiagnostics } from "./PromptFormatter";

describe("PromptFormatter", () => {
  const mockUri = { fsPath: "src/app.ts", path: "src/app.ts" } as vscode.Uri;

  it("formats a single line diagnostic correctly", () => {
    const diagnostic = {
      severity: 0,
      range: {
        start: { line: 9, character: 0 },
        end: { line: 9, character: 10 },
      },
      message: "Variable 'x' is not defined.",
    } as unknown as vscode.Diagnostic;

    const result = formatDiagnostic(diagnostic, mockUri);
    expect(result).toBe("@src/app.ts#L10\nError: Variable 'x' is not defined.");
  });

  it("formats a multi-line diagnostic correctly", () => {
    const diagnostic = {
      severity: 1,
      range: {
        start: { line: 9, character: 0 },
        end: { line: 14, character: 10 },
      },
      message: "Potential memory leak.",
    } as unknown as vscode.Diagnostic;

    const result = formatDiagnostic(diagnostic, mockUri);
    expect(result).toBe("@src/app.ts#L10-L15\nWarning: Potential memory leak.");
  });

  it("includes diagnostic code if available", () => {
    const diagnostic = {
      severity: 0,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      message: "Syntax error",
      code: "TS2345",
    } as vscode.Diagnostic;

    const result = formatDiagnostic(diagnostic, mockUri);
    expect(result).toBe("@src/app.ts#L1\nError: [TS2345] Syntax error");
  });

  it("includes numeric and object diagnostic codes", () => {
    const numericDiagnostic = {
      severity: 0,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      message: "Numeric code",
      code: 1234,
    } as vscode.Diagnostic;
    const objectDiagnostic = {
      severity: 0,
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 0 },
      },
      message: "Object code",
      code: { value: "RULE-1", target: mockUri },
    } as vscode.Diagnostic;

    expect(formatDiagnostic(numericDiagnostic, mockUri)).toBe(
      "@src/app.ts#L1\nError: [1234] Numeric code",
    );
    expect(formatDiagnostic(objectDiagnostic, mockUri)).toBe(
      "@src/app.ts#L2\nError: [RULE-1] Object code",
    );
  });

  it("omits falsy and unsupported diagnostic codes", () => {
    const falsyCodeDiagnostic = {
      severity: 0,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      message: "Falsy code",
      code: 0,
    } as vscode.Diagnostic;
    const unsupportedCodeDiagnostic = {
      severity: 0,
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 0 },
      },
      message: "Unsupported code",
      code: { target: mockUri },
    } as vscode.Diagnostic;

    expect(formatDiagnostic(falsyCodeDiagnostic, mockUri)).toBe(
      "@src/app.ts#L1\nError: Falsy code",
    );
    expect(formatDiagnostic(unsupportedCodeDiagnostic, mockUri)).toBe(
      "@src/app.ts#L2\nError: Unsupported code",
    );
  });

  it("truncates long messages", () => {
    const longMessage = "A".repeat(600);
    const diagnostic = {
      severity: 0,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      message: longMessage,
    } as vscode.Diagnostic;

    const result = formatDiagnostic(diagnostic, mockUri, 500);
    expect(result.length).toBeLessThan(600);
    expect(result).toContain("...");
  });

  it("formats multiple diagnostics", () => {
    const diagnostics = [
      {
        severity: 0,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        message: "Error 1",
      },
      {
        severity: 1,
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        message: "Warning 1",
      },
    ] as vscode.Diagnostic[];

    const result = formatDiagnostics(diagnostics, mockUri);
    expect(result).toBe(
      "@src/app.ts#L1\nError: Error 1\n\n@src/app.ts#L2\nWarning: Warning 1",
    );
  });

  it("handles different severity levels", () => {
    const levels = [
      { severity: 0, expected: "Error" },
      { severity: 1, expected: "Warning" },
      { severity: 2, expected: "Info" },
      { severity: 3, expected: "Hint" },
    ];

    levels.forEach((level) => {
      const diagnostic = {
        severity: level.severity,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        message: "Message",
      } as vscode.Diagnostic;
      const result = formatDiagnostic(diagnostic, mockUri);
      expect(result).toContain(`${level.expected}: Message`);
    });
  });

  it("uses a generic label for unknown severity values", () => {
    const diagnostic = {
      severity: 99,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      message: "Unknown severity",
    } as unknown as vscode.Diagnostic;

    expect(formatDiagnostic(diagnostic, mockUri)).toBe(
      "@src/app.ts#L1\nDiagnostic: Unknown severity",
    );
  });
});
