/** Astro route parameters retain escaped path separators. Decode one URL segment once. */
export function decodeIncidentID(value: string | undefined): string {
  return decodeURIComponent(value ?? '');
}
