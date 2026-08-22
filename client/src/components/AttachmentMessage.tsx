import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { File as FileIcon, Download, ExternalLink, X, Check, Loader2 } from 'lucide-react';
import { downloadWithProgress } from '../utils/download';

function formatBytes(b?: number | null) {
  if (!b && b !== 0) return '';
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} МБ`;
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
}

type AttachmentItem = {
  kind?: string;
  path: string;
  name?: string | null;
  size?: number | null;
  mime?: string | null;
};

/**
 * Превью прикреплённого файла внутри сообщения с поддержкой прогресса скачивания.
 */
export default function AttachmentMessage({ message, mine }: { message: any; mine?: boolean }) {
  const { kind, attachmentPath, attachmentName, attachmentSize, attachmentMime, payload } = message;
  const [imgZoom, setImgZoom] = useState<string | false>(false);

  if (!attachmentPath) return null;

  let additionalAttachments: AttachmentItem[] = [];
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (Array.isArray(parsed?.additionalAttachments)) {
      additionalAttachments = parsed.additionalAttachments;
    }
  } catch {
    /* ignore */
  }

  const allAttachments: AttachmentItem[] = [
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
          onZoom={att.kind === 'image' ? () => setImgZoom(att.path) : undefined}
          isZoomed={imgZoom === att.path}
          onCloseZoom={() => setImgZoom(false)}
        />
      ))}
    </div>
  );
}

function SingleAttachment({
  attachment,
  mine,
  onZoom,
  isZoomed,
  onCloseZoom,
}: {
  attachment: AttachmentItem;
  mine?: boolean;
  onZoom?: () => void;
  isZoomed?: boolean;
  onCloseZoom?: () => void;
}) {
  const { kind, path, name, size, mime } = attachment;
  const fileName = name || 'file';

  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; loaded: number; total: number } | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const abortCtrlRef = useRef<AbortController | null>(null);

  const startDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (downloading) return;

    const controller = new AbortController();
    abortCtrlRef.current = controller;
    setDownloading(true);
    setProgress({ percent: 0, loaded: 0, total: size || 0 });
    setDownloadSuccess(false);

    try {
      await downloadWithProgress(
        path,
        fileName,
        (percent, loaded, total) => {
          setProgress({ percent, loaded, total: total || size || 0 });
        },
        controller.signal,
      );
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 2000);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Download error:', err);
      }
    } finally {
      setDownloading(false);
      setProgress(null);
      abortCtrlRef.current = null;
    }
  };

  const cancelDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    abortCtrlRef.current?.abort();
  };

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
          <MediaActions
            path={path}
            name={fileName}
            downloading={downloading}
            progress={progress}
            success={downloadSuccess}
            onDownload={startDownload}
            onCancel={cancelDownload}
          />
        </div>
        {isZoomed && (
          <ImageZoomOverlay
            path={path}
            fileName={fileName}
            downloading={downloading}
            progress={progress}
            success={downloadSuccess}
            onDownload={startDownload}
            onCancel={cancelDownload}
            onClose={onCloseZoom!}
          />
        )}
      </>
    );
  }

  if (kind === 'video') {
    return (
      <div className="media-card group relative inline-block max-w-xs rounded-xl overflow-hidden bg-bg-3/60">
        <video src={path} controls className="block max-h-72 max-w-xs bg-black">
          <track kind="captions" />
        </video>
        <MediaActions
          path={path}
          name={fileName}
          downloading={downloading}
          progress={progress}
          success={downloadSuccess}
          onDownload={startDownload}
          onCancel={cancelDownload}
        />
      </div>
    );
  }

  return (
    <div
      onClick={!downloading ? startDownload : undefined}
      className={`media-card flex flex-col gap-1.5 rounded-xl px-3.5 py-2.5 max-w-[300px] cursor-pointer select-none transition-colors
        ${mine ? 'bg-white/10 hover:bg-white/20' : 'bg-bg-3/90 hover:bg-bg-2'}`}
      title={mime || ''}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center gap-3">
        <span
          className={`grid place-items-center w-10 h-10 rounded-lg shrink-0 transition-colors
          ${mine ? 'bg-white/15' : 'bg-bg-2/90'}`}
        >
          {downloading ? (
            <Loader2 size={20} className="animate-spin text-accent" />
          ) : downloadSuccess ? (
            <Check size={20} className="text-emerald-400" />
          ) : (
            <FileIcon size={20} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{fileName}</div>
          <div className="text-[11px] opacity-75">
            {downloading && progress
              ? `${progress.percent}% (${formatBytes(progress.loaded)} из ${formatBytes(progress.total)})`
              : formatBytes(size)}
          </div>
        </div>

        {downloading ? (
          <button
            type="button"
            onClick={cancelDownload}
            className="interactive-scale p-1.5 rounded-lg bg-black/40 hover:bg-black/60 text-slate-300 hover:text-white"
            title="Отменить скачивание"
          >
            <X size={16} />
          </button>
        ) : (
          <Download size={16} className="shrink-0 opacity-70" />
        )}
      </div>

      {downloading && progress && (
        <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-accent h-full transition-all duration-150 ease-out"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}
    </div>
  );
}

/* ---------- внутренние компоненты ---------- */

function MediaActions({
  path,
  name,
  downloading,
  progress,
  success,
  onDownload,
  onCancel,
}: {
  path: string;
  name: string;
  downloading: boolean;
  progress: { percent: number; loaded: number; total: number } | null;
  success: boolean;
  onDownload: (e: React.MouseEvent) => void;
  onCancel: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`absolute top-1.5 right-1.5 flex items-center gap-1
                 ${downloading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}
                 transition duration-150 ease-out`}
      onClick={(e) => e.stopPropagation()}
    >
      <OpenButton path={path} />
      <DownloadButton
        name={name}
        downloading={downloading}
        progress={progress}
        success={success}
        onDownload={onDownload}
        onCancel={onCancel}
      />
    </div>
  );
}

function ImageZoomOverlay({
  path,
  fileName,
  downloading,
  progress,
  success,
  onDownload,
  onCancel,
  onClose,
}: {
  path: string;
  fileName: string;
  downloading: boolean;
  progress: { percent: number; loaded: number; total: number } | null;
  success: boolean;
  onDownload: (e: React.MouseEvent) => void;
  onCancel: (e: React.MouseEvent) => void;
  onClose: () => void;
}) {
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
        <DownloadButton
          name={fileName}
          downloading={downloading}
          progress={progress}
          success={success}
          onDownload={onDownload}
          onCancel={onCancel}
        />
      </div>
    </div>,
    document.body,
  );
}

function OpenButton({ path }: { path: string }) {
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

function DownloadButton({
  name,
  downloading,
  progress,
  success,
  onDownload,
  onCancel,
}: {
  name: string;
  downloading: boolean;
  progress: { percent: number; loaded: number; total: number } | null;
  success: boolean;
  onDownload: (e: React.MouseEvent) => void;
  onCancel: (e: React.MouseEvent) => void;
}) {
  if (downloading) {
    return (
      <button
        type="button"
        onClick={onCancel}
        title="Отменить скачивание"
        className="interactive-scale inline-flex items-center justify-center gap-1 h-8 px-2 rounded-lg bg-black/80 text-white backdrop-blur border border-accent/40 text-xs font-mono"
      >
        <Loader2 size={12} className="animate-spin text-accent" />
        <span>{progress?.percent ?? 0}%</span>
        <X size={12} className="ml-0.5 text-rose-400" />
      </button>
    );
  }

  if (success) {
    return (
      <div
        title="Скачано"
        className="inline-grid place-items-center w-8 h-8 rounded-lg bg-emerald-600 text-white backdrop-blur"
      >
        <Check size={14} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onDownload}
      title={`Скачать ${name}`}
      className="interactive-scale inline-grid place-items-center w-8 h-8 rounded-lg bg-black/60 hover:bg-black/80 text-white backdrop-blur"
    >
      <Download size={14} />
    </button>
  );
}
