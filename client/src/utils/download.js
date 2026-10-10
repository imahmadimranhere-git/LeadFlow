// Downloads a file from our API (with the login token) and saves it — used for PDFs.
import api from '../lib/api.js';

export async function downloadFromApi(path, fallbackName) {
  const res = await api.get(path, { responseType: 'blob' });
  const cd = res.headers['content-disposition'] || '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Axios errors from blob requests carry JSON as a Blob — turn it back into a message. */
export async function blobErrorMessage(err) {
  try {
    const text = await err?.response?.data?.text?.();
    return JSON.parse(text).message || 'Download failed';
  } catch {
    return 'Download failed';
  }
}

/** Same as downloadFromApi, but for POST endpoints that return a file (e.g. hashtag report with a password). */
export async function postDownloadFromApi(path, body, fallbackName) {
  const res = await api.post(path, body, { responseType: 'blob' });
  const cd = res.headers['content-disposition'] || '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
