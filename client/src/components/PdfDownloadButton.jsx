// A button that downloads a server-made PDF (quote, invoice, lead dossier) with the login token.
import { useState } from 'react';
import { Button } from './ui.jsx';
import { useToast } from './Toast.jsx';
import { downloadFromApi, blobErrorMessage } from '../utils/download.js';

export default function PdfDownloadButton({ path, fileName = 'document.pdf', children = 'Download PDF', variant = 'ghost', className = '' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await downloadFromApi(path, fileName);
    } catch (e) {
      toast.error(await blobErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return <Button variant={variant} className={className} loading={busy} onClick={run}>{children}</Button>;
}
