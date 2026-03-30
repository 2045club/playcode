export type ParsedFileLink = {
  originalHref: string;
  filePath: string;
  line: number | null;
  column: number | null;
};

function parsePositiveInteger(value?: string) {
  if (!value) {
    return null;
  }

  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

function decodePathSafely(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseFileLink(href: string): ParsedFileLink {
  const trimmedHref = href.trim();
  const hashIndex = trimmedHref.indexOf("#");
  const hrefWithoutHash =
    hashIndex >= 0 ? trimmedHref.slice(0, hashIndex) : trimmedHref;
  const hash = hashIndex >= 0 ? trimmedHref.slice(hashIndex) : "";
  const queryIndex = hrefWithoutHash.indexOf("?");
  const pathWithPossibleLineSuffix =
    queryIndex >= 0 ? hrefWithoutHash.slice(0, queryIndex) : hrefWithoutHash;
  const hashLocationMatch = hash.match(/^#L(\d+)(?:C(\d+))?$/i);
  let filePath = pathWithPossibleLineSuffix;
  let line = parsePositiveInteger(hashLocationMatch?.[1]);
  let column = parsePositiveInteger(hashLocationMatch?.[2]);

  if (line === null) {
    const lineSuffixMatch = pathWithPossibleLineSuffix.match(
      /^(.*):(\d+)(?::(\d+))?$/,
    );

    if (lineSuffixMatch?.[1]) {
      filePath = lineSuffixMatch[1];
      line = parsePositiveInteger(lineSuffixMatch[2]);
      column = parsePositiveInteger(lineSuffixMatch[3]);
    }
  }

  return {
    originalHref: href,
    filePath: decodePathSafely(filePath),
    line,
    column,
  };
}

export function getFileLinkDisplayPath(href: string) {
  return parseFileLink(href).filePath;
}
