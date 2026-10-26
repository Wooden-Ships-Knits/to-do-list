import { matchWikilinks, normalizeTarget, openLinkQuery, targetKey } from './wikilinks';

describe('wikilinks', () => {
  it('finds links with and without labels, with positions', () => {
    const text = 'See [[Payroll ideas]] and [[HR App|the HR app]].';
    const [a, b] = matchWikilinks(text, 10);
    expect(a).toMatchObject({ target: 'Payroll ideas', label: null, from: 14, to: 31 });
    expect(text.slice(a!.targetFrom - 10, a!.targetTo - 10)).toBe('Payroll ideas');
    expect(b).toMatchObject({ target: 'HR App', label: 'the HR app' });
    expect(text.slice(b!.labelFrom! - 10, b!.to - 10 - 2)).toBe('the HR app');
  });

  it('keeps the subtask separator and squeezes spaces', () => {
    expect(matchWikilinks('[[ HR App  >  Fix ]]')[0]?.target).toBe('HR App > Fix');
    expect(normalizeTarget('  a   b ')).toBe('a b');
    expect(targetKey(' Plan  A ')).toBe('plan a');
  });

  it('ignores empty and broken links', () => {
    expect(matchWikilinks('[[]] [[ ]] [[a\nb]] [single] [[x]')).toEqual([]);
  });

  it('finds what is being typed after an unclosed [[', () => {
    expect(openLinkQuery('text [[Pay')).toBe('Pay');
    expect(openLinkQuery('text [[')).toBe('');
    expect(openLinkQuery('text [[done]] more')).toBeNull();
    expect(openLinkQuery('text [[a|label')).toBeNull();
    expect(openLinkQuery('no link')).toBeNull();
  });
});
