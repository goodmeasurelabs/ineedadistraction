export function validateGame(body: Record<string, unknown>, partial = false): string | null {
  for (const [key, max] of [['title', 120], ['description', 2000], ['emoji', 24], ['html', 500000], ['author', 80]] as const) {
    const value = body[key];
    if (value === undefined && (partial || !['title', 'html'].includes(key))) continue;
    if (typeof value !== 'string' || value.length > max || (['title', 'html'].includes(key) && !value.trim())) return `Invalid ${key} (maximum ${max} characters).`;
  }
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 10 || body.tags.some((t) => typeof t !== 'string' || t.length > 40))) return 'Use up to 10 short tags.';
  for (const key of ['remixable', 'published']) if (body[key] !== undefined && typeof body[key] !== 'boolean') return `Invalid ${key}.`;
  return null;
}
