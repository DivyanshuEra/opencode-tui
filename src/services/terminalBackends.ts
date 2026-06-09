import { TerminalBackendType, TerminalBackendAvailability } from "../types";

export interface TerminalBackend {
  readonly type: TerminalBackendType;
  readonly label: string;
  isAvailable(): boolean;
}

export class StaticTerminalBackend implements TerminalBackend {
  public constructor(
    public readonly type: TerminalBackendType,
    public readonly label: string,
    private readonly available: boolean,
  ) {}

  public isAvailable(): boolean {
    return this.available;
  }
}

export class TerminalBackendRegistry {
  private readonly order: TerminalBackendType[] = ["native", "tmux", "zellij"];
  private readonly backends = new Map<TerminalBackendType, TerminalBackend>();

  public constructor(backends: readonly TerminalBackend[]) {
    for (const backend of backends) {
      this.backends.set(backend.type, backend);
    }
  }

  public getAvailability(): TerminalBackendAvailability {
    return {
      native: this.isAvailable("native"),
      tmux: this.isAvailable("tmux"),
      zellij: this.isAvailable("zellij"),
    };
  }

  public isAvailable(type: TerminalBackendType): boolean {
    return this.backends.get(type)?.isAvailable() ?? false;
  }

  public resolveAvailable(
    requested: TerminalBackendType,
    fallback: TerminalBackendType = "native",
  ): TerminalBackendType {
    if (this.isAvailable(requested)) {
      return requested;
    }
    return this.isAvailable(fallback) ? fallback : "native";
  }

  public nextAvailable(current: TerminalBackendType): TerminalBackendType {
    const startIndex = this.order.indexOf(current);
    const offset = startIndex >= 0 ? startIndex : 0;
    for (let step = 1; step <= this.order.length; step += 1) {
      const candidate = this.order[(offset + step) % this.order.length];
      if (this.isAvailable(candidate)) {
        return candidate;
      }
    }
    return "native";
  }
}

/** Specification for launching a terminal process. */
export interface TerminalLaunchSpec {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  name?: string;
}

/** Versioned state persisted alongside an instance for backend restore. */
export interface BackendSessionState {
  version: 1;
  backend: TerminalBackendType;
  sessionId?: string;
  restoreMode: "reattach" | "recreate";
  launchSpec: TerminalLaunchSpec;
  createdAt: number;
  lastSeenAt?: number;
}

/** Plan produced by a backend manager for creating or restoring a session. */
export interface BackendLaunchPlan {
  backend: TerminalBackendType;
  restoreMode: "reattach" | "recreate";
  launchSpec: TerminalLaunchSpec;
  sessionId?: string;
  state: BackendSessionState;
}

/** Manager interface for a specific terminal backend. */
export interface TerminalBackendManager {
  readonly type: TerminalBackendType;
  isAvailable(): boolean;
  create(
    instanceId: string,
    options: { command: string; args?: string[]; cwd?: string },
  ): BackendLaunchPlan;
  restore?(savedState: BackendSessionState): BackendLaunchPlan | undefined;
  stop?(): void;
}
