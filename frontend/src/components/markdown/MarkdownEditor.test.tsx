import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MarkdownEditor } from './MarkdownEditor';

function Harness({
  initial = '',
  onChange = vi.fn(),
}: {
  initial?: string;
  onChange?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <span id="lbl">Notes</span>
      <MarkdownEditor
        id="notes"
        labelId="lbl"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
      />
      <button type="button" onClick={() => setValue('reset from outside')}>
        reset
      </button>
    </div>
  );
}

async function editor(): Promise<HTMLElement> {
  await screen.findByTestId('markdown-editor');
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>('.cm-content');
    if (!el) throw new Error('editor not ready');
    return el;
  });
}

describe('MarkdownEditor', () => {
  it('is a labelled multi-line textbox with a formatting toolbar', async () => {
    render(<Harness initial="hello" />);
    const content = await editor();
    expect(content).toHaveAttribute('id', 'notes');
    expect(content).toHaveAttribute('aria-labelledby', 'lbl');
    expect(content).toHaveAttribute('role', 'textbox');
    expect(content).toHaveAttribute('aria-multiline', 'true');
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Bold/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Checklist/ })).toBeInTheDocument();
    expect(content).toHaveTextContent('hello');
  });

  it('toolbar buttons edit the Markdown and report the new value', async () => {
    const onChange = vi.fn();
    render(<Harness initial="" onChange={onChange} />);
    await editor();
    await userEvent.click(screen.getByRole('button', { name: /^Checklist/ }));
    expect(onChange).toHaveBeenLastCalledWith('- [ ] ');
  });

  it('follows value changes from outside without echoing them back', async () => {
    const onChange = vi.fn();
    render(<Harness initial="first" onChange={onChange} />);
    const content = await editor();
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'reset' }));
    });
    expect(content).toHaveTextContent('reset from outside');
    expect(onChange).not.toHaveBeenCalled();
  });
});
