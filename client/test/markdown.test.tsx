import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderMarkdown } from '../src/utils/markdown';

function renderMd(text) {
  return render(<div data-testid="md">{renderMarkdown(text)}</div>);
}

describe('renderMarkdown', () => {
  it('renders plain text in a span block', () => {
    const { getByTestId } = renderMd('hello world');
    expect(getByTestId('md').textContent).toBe('hello world');
  });

  it('renders **bold** as <strong>', () => {
    const { container } = renderMd('a **bold** word');
    expect(container.querySelector('strong')).not.toBeNull();
    expect(container.querySelector('strong').textContent).toBe('bold');
  });

  it('renders *italic* as <em>', () => {
    const { container } = renderMd('a *quiet* word');
    expect(container.querySelector('em')).not.toBeNull();
    expect(container.querySelector('em').textContent).toBe('quiet');
  });

  it('renders inline `code` as <code>', () => {
    const { container } = renderMd('use `npm test` here');
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code.textContent).toBe('npm test');
  });

  it('renders fenced code blocks as <pre><code>', () => {
    const { container } = renderMd('```js\nconst a = 1;\n```');
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre.textContent).toContain('const a = 1;');
  });

  it('linkifies bare URLs', () => {
    const { container } = renderMd('open https://example.com now');
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a.getAttribute('href')).toBe('https://example.com');
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it('renders [text](url) as anchor', () => {
    const { container } = renderMd('see [docs](https://example.com/docs) page');
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a.textContent).toBe('docs');
    expect(a.getAttribute('href')).toBe('https://example.com/docs');
  });

  it('does not render unsafe javascript: links', () => {
    const { container } = renderMd('click [bad](javascript:alert(1))');
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders blockquote', () => {
    const { container } = renderMd('> quoted line');
    expect(container.querySelector('blockquote')).not.toBeNull();
  });

  it('renders bullet lists', () => {
    const { container } = renderMd('- a\n- b\n- c');
    expect(container.querySelector('ul')).not.toBeNull();
    expect(container.querySelectorAll('li').length).toBe(3);
  });
});
