/** Initials: the first letter of up to the first two words ("Ann Lee" -> "AL", "Denan" -> "D"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((w) => (w[0] ?? '').toUpperCase()).join('');
}

export const AVATAR_COLORS = 8;

/** A stable colour slot (1..8) derived from the name, so a person always has the same colour. */
export function avatarSlot(name: string): number {
  let hash = 0;
  for (const ch of name.trim().toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
  return (hash % AVATAR_COLORS) + 1;
}

export function stageSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}
