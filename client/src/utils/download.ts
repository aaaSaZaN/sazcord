/**
 * Загрузка файлов с сервера с отображением прогресса и возможностью отмены.
 */

export type DownloadProgressCallback = (percent: number, loadedBytes: number, totalBytes: number) => void;

export function downloadWithProgress(
  url: string,
  fileName: string,
  onProgress?: DownloadProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'blob';

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => {
        xhr.abort();
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }

    xhr.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percent = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)));
        onProgress?.(percent, event.loaded, event.total);
      } else {
        onProgress?.(0, event.loaded, 0);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const blob = xhr.response;
          const blobUrl = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = blobUrl;
          a.download = fileName || 'download';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(blobUrl);
          }, 1500);
          resolve();
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error(`Ошибка скачивания: HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Ошибка сети при скачивании файла'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));

    xhr.send();
  });
}
