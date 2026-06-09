import { postMessage } from "../shared/vscode-api";

interface Link {
  text: string;
  range: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  activate: () => void;
}

interface LinkTerminal {
  buffer: {
    active: {
      getLine: (lineNumber: number) =>
        | {
            translateToString: (trimRight?: boolean) => string;
          }
        | undefined;
    };
  };
}

const MAX_LINE_LENGTH = 10000;
const FILE_NAME_PATTERN =
  "[A-Za-z0-9_.-]+\\.(?:c|cc|cpp|cs|css|cts|env|fish|go|h|hpp|html|java|js|json|jsx|kt|lock|lua|md|mjs|mts|php|py|rb|rs|scss|sh|swift|toml|ts|tsx|txt|yaml|yml|zsh)";
const PATH_REGEX = new RegExp(
  `(^|[\\s"'\\\`([{<])(@?((?:(?:file:\\/\\/|\\/|[A-Za-z]:\\\\|\\.?\\.?\\/)[^\\s"'#:]+|[^\\s":\\/]+(?:\\/[^\\s":\\/]+)+|${FILE_NAME_PATTERN}))(?::(\\d+)(?::(\\d+))?)?(?:#L(\\d+)(?:-L?(\\d+))?)?)(?=[\\s"'\\\`\\])}>]|$)`,
  "gi",
);

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const decodeFileUrlPath = (path: string): string | undefined => {
  if (!path.startsWith("file://")) {
    return path;
  }

  try {
    const url = new URL(path);
    const decodedPath = decodeURIComponent(url.pathname);
    return url.hostname && !url.pathname.startsWith("/")
      ? `${url.hostname}:${decodedPath}`
      : decodedPath;
  } catch {
    return undefined;
  }
};

export function createLinkProvider(terminal: LinkTerminal) {
  return {
    provideLinks(
      bufferLineNumber: number,
      callback: (links: Link[] | undefined) => void,
    ) {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      const lineText = line.translateToString(true);

      if (lineText.length > MAX_LINE_LENGTH) {
        callback(undefined);
        return;
      }

      const links: Link[] = [];
      PATH_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null = PATH_REGEX.exec(lineText);
      let lastIndex = -1;

      while (match) {
        if (match.index === lastIndex) {
          PATH_REGEX.lastIndex++;
          match = PATH_REGEX.exec(lineText);
          continue;
        }
        lastIndex = match.index;

        const fullMatch = match[2];
        const pathWithPrefix = match[3];
        if (!fullMatch || !pathWithPrefix) {
          match = PATH_REGEX.exec(lineText);
          continue;
        }

        const hasAtPrefix = fullMatch.startsWith("@");
        const decodedPath = decodeFileUrlPath(pathWithPrefix);
        if (!decodedPath) {
          match = PATH_REGEX.exec(lineText);
          continue;
        }

        const lineNumber =
          parsePositiveInteger(match[6]) ?? parsePositiveInteger(match[4]);
        const columnNumber = parsePositiveInteger(match[5]);
        const endLineNumber = parsePositiveInteger(match[7]);
        const index = match.index + (match[1]?.length ?? 0);
        const linkText = hasAtPrefix ? `@${pathWithPrefix}` : pathWithPrefix;

        links.push({
          text: linkText,
          range: {
            start: { x: index + 1, y: bufferLineNumber },
            end: { x: index + linkText.length, y: bufferLineNumber },
          },
          activate: () => {
            postMessage({
              type: "openFile",
              path: decodedPath,
              line: lineNumber,
              endLine: endLineNumber,
              column: columnNumber,
            });
          },
        });

        match = PATH_REGEX.exec(lineText);
      }

      callback(links);
    },
  };
}
