import { useState } from 'react';
import { createPortal } from 'react-dom';
import { File as FileIcon, Download, ExternalLink } from 'lucide-react';

function formatBytes(b) {
  if (!b && b !== 0) return '';
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} МБ`;
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
}

/**
 * Превью прикреплённого файла внутри сообщения.
 * Поддерживает kind ∈ { 'image', 'video', 'file' }.
 * Поддерживает multiple attachments из payload.additionalAttachments.
 *
 * У image/video — оверлей с кнопками "Скачать" и "Открыть в новой вкладке",
 * появляется при наведении/тапе.
 */
export default function AttachmentMessage({ message, mine }) {
  const { kind, attachmentPath, attachmentName, attachmentSize, attachmentMime, payload } = message;
  const [imgZoom, setImgZoom] = useState(false);

  if (!attachmentPath) return null;

  const fileName = attachmentName || 'file';
  const additionalAttachments = payload?.additionalAttachments || [];
  const allAttachments = [
    {
      kind,
      path: attachmentPath,
      name: attachmentName,
      size: attachmentSize,
      mime: attachmentMime,
    },
    ...additionalAttachments,
  ];

  return (
    <div className="space-y-2">
      {allAttachments.map((att, idx) => (
        <SingleAttachment
          key={idx}
          attachment={att}
          mine={mine}
          onZoom={att.kind === 'image' ? () => setImgZoom(att.path) : null}
          isZoomed={imgZoom === att.path}
          onCloseZoom={() => setImgZoom(false)}
        />
      ))}
    </div>
  );
}

function SingleAttachment({ attachment, mine, onZoom, isZoomed, onCloseZoom }) {
  const { kind, path, name, size, mime } = attachment;
  const fileName = name || 'file';

  if (kind === 'image') {
    return (
      <>
        <div className="media-card group relative inline-block max-w-xs rounded-xl overflow-hidden bg-bg-3/60">
          <button type="button" className="block cursor-zoom-in" onClick={onZoom} title={fileName}>
            <img
              src={path}
              alt={fileName}
              className="block max-h-64 w-auto object-contain transition duration-200 ease-out group-hover:scale-[1.015]"
              loading="lazy"
            />
          </button>
          <MediaActions path={path} name={fileName} />
        </div>
        {isZoomed && <ImageZoomOverlay path={path} fileName={fileName} onClose={onCloseZoom} />}
      </>
    );
  }

  if (kind === 'video') {
    return (
      <div className="media-card group relative inline-block max-w-xs rounded-xl overflow-hidden bg-bg-3/60">
        <video src={path} controls className="block max-h-72 max-w-xs bg-black">
          <track kind="captions" />
        </video>
        <MediaActions path={path} name={fileName} />
      </div>
    );
  }

  return (
    <a
      href={path}
      download={fileName}
      target="_blank"
      rel="noopener noreferrer"
      className={`media-card flex items-center gap-3 rounded-xl px-3 py-2 max-w-[280px] no-underline
        ${mine ? 'bg-white/10 hover:bg-white/20' : 'bg-bg-3/90 hover:bg-bg-2'}`}
      title={mime || ''}
    >
      <span
        className={`grid place-items-center w-9 h-9 rounded-lg shrink-0
        ${mine ? 'bg-white/15' : 'bg-bg-2/90'}`}
      >
        <FileIcon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{fileName}</div>
        <div className="text-[11px] opacity-70">{formatBytes(size)}</div>
      </div>
      <Download size={14} className="shrink-0 opacity-70" />
    </a>
  );
}

/* ---------- внутренние компоненты ---------- */

function MediaActions({ path, name }) {
  return (
    <div
      className="absolute top-1.5 right-1.5 flex items-center gap-1
                 opacity-0 group-hover:opacity-100 focus-within:opacity-100
                 transition duration-150 ease-out"
      onClick={(e) => e.stopPropagation()}
    >
      <OpenButton path={path} />
      <DownloadButton path={path} name={name} />
    </div>
  );
}

function ImageZoomOverlay({ path, fileName, onClose }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[90] bg-black/85 backdrop-blur-sm grid place-items-center p-4 cursor-zoom-out"
      onClick={onClose}
      role="dialog"
    >
      <img
        src={path}
        alt={fileName}
        className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] object-contain"
      />
      <div
        className="absolute top-4 right-4 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <OpenButton path={path} />
        <DownloadButton path={path} name={fileName} />
      </div>
    </div>,
    document.body,
  );
}

function OpenButton({ path }) {
  return (
    <a
      href={path}
      target="_blank"
      rel="noopener noreferrer"
      title="Открыть в новой вкладке"
      className="interactive-scale inline-grid place-items-center w-8 h-8 rounded-lg bg-black/60 hover:bg-black/80 text-white backdrop-blur"
    >
      <ExternalLink size={14} />
    </a>
  );
}

function DownloadButton({ path, name }) {
  return (
    <a
      href={path}
      download={name}
      title="Скачать"
      className="interactive-scale inline-grid place-items-center w-8 h-8 rounded-lg bg-black/60 hover:bg-black/80 text-white backdrop-blur"
    >
      <Download size={14} />
    </a>
  );
}
