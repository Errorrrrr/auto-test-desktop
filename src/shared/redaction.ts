export function redactReportText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value
    .replace(/\b(authorization)\s*:\s*(?:bearer\s+)?[^\s`'"<>]+/gi, '$1: [REDACTED]')
    .replace(/\b(token|password|passwd|secret|api[_-]?key)\s*[:=]\s*[^\s`'"<>]+/gi, '$1=[REDACTED]')
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs]?)-[A-Za-z0-9_-]{8,}/g, '[REDACTED_SECRET]')
    .replace(/\/Users\/[^/\s`'"<>]+/g, '/Users/[REDACTED]')
    .replace(/[A-Za-z]:\\Users\\[^\\\s`'"<>]+/g, 'C:\\Users\\[REDACTED]');
}
