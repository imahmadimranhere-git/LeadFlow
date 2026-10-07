import { useEffect } from 'react';

export default function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · LeadFlow ERP` : 'LeadFlow ERP';
  }, [title]);
}
