export function isCurrentPath(path: string, match: string): boolean {
  return match === '/' ? path === '/' : path.startsWith(match);
}
