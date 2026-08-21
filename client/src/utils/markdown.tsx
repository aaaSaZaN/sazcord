/**
 * Минимальный безопасный markdown-рендерер без зависимостей.
 * Преобразует строку в массив React-нод (без dangerouslySetInnerHTML).
 *
 * Поддерживает:
 *   **bold**          → <strong>
 *   *italic* / _it_   → <em>
 *   ~~strike~~        → <del>
 *   `code`            → <code> (inline)
 *   ```code```        → <pre><code> (block)
 *   > quote           → блок-цитата (по строке)
 *   - / * / 1.        → списки (только верхний уровень)
 *   [text](http://…)  → <a target=_blank rel=noopener>
 *   автоссылки https://…
 *
 * Для звонков/системных сообщений markdown не используется.
 */

const URL_RE = /(https?:\/\/[^\s<>"]+)/g;

function escapeText(s) {
  // React сам экранирует — оставляем как есть для текстовых нод.
  return s;
}

// Парсинг inline-разметки в массив нод. Идём сверху-вниз по приоритету:
// сначала вырезаем code, потом ссылки, потом bold/italic/strike.
function inline(input, keyPrefix = 'i') {
  const parts = [];
  let i = 0;
  let buf = '';
  let counter = 0;
  const flush = () => {
    if (buf) {
      parts.push(buf);
      buf = '';
    }
  };
  const k = () => `${keyPrefix}-${counter++}`;

  while (i < input.length) {
    const ch = input[i];

    // inline code `...`
    if (ch === '`') {
      const end = input.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        parts.push(
          <code key={k()} className="px-1 py-0.5 rounded bg-black/30 font-mono text-[0.9em]">
            {input.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }

    // bold **...**
    if (ch === '*' && input[i + 1] === '*') {
      const end = input.indexOf('**', i + 2);
      if (end !== -1) {
        flush();
        parts.push(
          <strong key={k()} className="font-semibold">
            {inline(input.slice(i + 2, end), `${keyPrefix}b${counter}`)}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }

    // strike ~~...~~
    if (ch === '~' && input[i + 1] === '~') {
      const end = input.indexOf('~~', i + 2);
      if (end !== -1) {
        flush();
        parts.push(
          <del key={k()}>{inline(input.slice(i + 2, end), `${keyPrefix}s${counter}`)}</del>,
        );
        i = end + 2;
        continue;
      }
    }

    // italic *...*  (но не **) или _..._
    if ((ch === '*' || ch === '_') && input[i + 1] !== ch) {
      // не считаем italic'ом, если перед ним нет границы слова
      const prev = input[i - 1];
      const isBoundary = !prev || /[\s({[.,!?]/.test(prev);
      if (isBoundary) {
        const end = input.indexOf(ch, i + 1);
        if (end !== -1 && end > i + 1) {
          flush();
          parts.push(
            <em key={k()} className="italic">
              {inline(input.slice(i + 1, end), `${keyPrefix}i${counter}`)}
            </em>,
          );
          i = end + 1;
          continue;
        }
      }
    }

    // link [text](url)
    if (ch === '[') {
      const closeText = input.indexOf(']', i + 1);
      if (closeText !== -1 && input[closeText + 1] === '(') {
        const closeUrl = input.indexOf(')', closeText + 2);
        if (closeUrl !== -1) {
          const text = input.slice(i + 1, closeText);
          const url = input.slice(closeText + 2, closeUrl).trim();
          if (/^(https?:|mailto:)/i.test(url)) {
            flush();
            parts.push(
              <a
                key={k()}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-400 hover:text-sky-300 underline break-all transition-colors"
              >
                {inline(text, `${keyPrefix}l${counter}`)}
              </a>,
            );
            i = closeUrl + 1;
            continue;
          }
        }
      }
    }

    buf += ch;
    i++;
  }
  flush();

  // Автолинкование URL в оставшихся текстовых нодах
  return parts.flatMap((node, idx) => {
    if (typeof node !== 'string') return [node];
    const out = [];
    let lastEnd = 0;
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(node)) !== null) {
      const start = m.index;
      if (start > lastEnd) out.push(node.slice(lastEnd, start));
      const url = m[1].replace(/[),.!?]+$/, '');
      const trail = m[1].slice(url.length);
      out.push(
        <a
          key={`${keyPrefix}-u-${idx}-${start}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-accent break-all"
        >
          {url}
        </a>,
      );
      if (trail) out.push(trail);
      lastEnd = start + m[1].length;
    }
    if (lastEnd < node.length) out.push(node.slice(lastEnd));
    return out.length ? out : [escapeText(node)];
  });
}

/**
 * Главная функция: возвращает массив React-блоков.
 */
export function renderMarkdown(text) {
  if (!text) return [];
  const out = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  let i = 0;
  let key = 0;
  const k = () => `b-${key++}`;

  while (i < lines.length) {
    // Code block ```...```
    if (lines[i].startsWith('```')) {
      const lang = lines[i].slice(3).trim();
      let j = i + 1;
      const codeLines = [];
      while (j < lines.length && !lines[j].startsWith('```')) {
        codeLines.push(lines[j]);
        j++;
      }
      out.push(
        <pre
          key={k()}
          className="my-1 px-3 py-2 rounded bg-black/40 font-mono text-[0.85em] overflow-x-auto whitespace-pre"
          data-lang={lang || undefined}
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      i = j + 1;
      continue;
    }

    // Blockquote >
    if (/^>\s?/.test(lines[i])) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(
        <blockquote key={k()} className="my-1 pl-3 border-l-2 border-white/30 text-white/80">
          {inline(buf.join('\n'), k())}
        </blockquote>,
      );
      continue;
    }

    // Bullet list
    if (/^[-*]\s+/.test(lines[i])) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      out.push(
        <ul key={k()} className="list-disc list-inside space-y-0.5 my-1">
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `${k()}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(lines[i])) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      out.push(
        <ol key={k()} className="list-decimal list-inside space-y-0.5 my-1">
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `${k()}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Параграф: схлопываем подряд идущие непустые строки в один абзац.
    if (lines[i].trim() === '') {
      i++;
      continue;
    }
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !/^>\s?/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    out.push(
      <span key={k()} className="block">
        {inline(paraLines.join('\n'), k())}
      </span>,
    );
  }

  return out;
}
