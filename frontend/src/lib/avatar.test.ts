import { AVATAR_COLORS, avatarSlot, initials, stageSlug } from './avatar';

describe('avatars', () => {
  it('initials: first letter of up to two words', () => {
    expect(initials('Denan')).toBe('D');
    expect(initials('  ann  lee ')).toBe('AL');
    expect(initials('Mary Jane Watson')).toBe('MJ');
    expect(initials('')).toBe('');
  });
  it('the colour is stable per name (case and spaces ignored) and inside the palette', () => {
    expect(avatarSlot('Prada')).toBe(avatarSlot('  prada '));
    for (const n of ['Denan', 'Luthfi', 'Prada', 'Dzawil', 'Andika', 'Zed', 'Q']) {
      const slot = avatarSlot(n);
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(slot).toBeLessThanOrEqual(AVATAR_COLORS);
    }
  });
  it('stage slug matches the --dot-* tokens', () => {
    expect(stageSlug('In Development')).toBe('in-development');
    expect(stageSlug('Under Maintenance')).toBe('under-maintenance');
  });
});
