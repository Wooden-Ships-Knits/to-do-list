import { render, screen } from '@testing-library/react';
import MarkdownView from './MarkdownRender';
import { safeUrl } from './safeUrl';

describe('safeUrl', () => {
  it('keeps http(s) and mailto, drops everything that could run code', () => {
    expect(safeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeUrl('mailto:team@example.com')).toBe('mailto:team@example.com');
    expect(safeUrl('example.com/page')).toBe('https://example.com/page');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl(' JavaScript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<b>x</b>')).toBeNull();
    expect(safeUrl('vbscript:msgbox')).toBeNull();
    expect(safeUrl('/relative/path')).toBeNull();
    expect(safeUrl('')).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });
});

describe('MarkdownView', () => {
  it('renders GFM: emphasis, lists, code, links, strikethrough, tables', () => {
    const { container } = render(
      <MarkdownView
        text={[
          '## Plan',
          '**bold** and *italic* and `code` and ~~gone~~',
          '- one',
          '- two',
          '',
          '[docs](https://example.com)',
          '',
          '| a | b |',
          '| - | - |',
          '| 1 | 2 |',
        ].join('\n')}
      />,
    );
    expect(screen.getByText('Plan')).toHaveClass(/heading/);
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('em')).toHaveTextContent('italic');
    expect(container.querySelector('code')).toHaveTextContent('code');
    expect(container.querySelector('del')).toHaveTextContent('gone');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('never renders raw HTML or dangerous links', () => {
    const { container } = render(
      <MarkdownView
        text={[
          '<img src=x onerror="alert(1)"><script>alert(2)</script>',
          '',
          '[click](javascript:alert(3))',
          '',
          '<a href="https://evil.example">html link</a>',
        ].join('\n')}
      />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'click' })).toBeNull();
    expect(screen.getByText('click').tagName).toBe('SPAN');
    expect(container.querySelector('a[href="https://evil.example"]')).toBeNull();
  });

  it('does not load remote images; the alt text links to them instead', () => {
    const { container } = render(<MarkdownView text="![chart](https://example.com/c.png)" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'Image: chart' })).toHaveAttribute(
      'href',
      'https://example.com/c.png',
    );
  });

  it('shows task list items with a text equivalent, not as form controls', () => {
    const { container } = render(<MarkdownView text={'- [x] totals match\n- [ ] row counts'} />);
    expect(container.querySelector('input')).toBeNull();
    const items = container.querySelectorAll('li');
    expect(items[0]).toHaveTextContent('Done: totals match');
    expect(items[1]).toHaveTextContent('Not done: row counts');
  });

  it('keeps plain text as it was (existing notes are plain text)', () => {
    render(<MarkdownView text="Ongoing, waiting on WISER response" compact />);
    expect(screen.getByText('Ongoing, waiting on WISER response')).toBeInTheDocument();
  });
});

describe('MarkdownView (lazy wrapper)', () => {
  it('shows the formatted text once the renderer has loaded', async () => {
    const { MarkdownView: Lazy } = await import('./MarkdownView');
    const { container, findByText } = render(<Lazy text="**done** soon" compact />);
    expect(await findByText('done')).toHaveProperty('tagName', 'STRONG');
    expect(container.textContent).toBe('done soon');
  });
});
