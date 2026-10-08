import { useEffect, useState } from 'react';
import api from '../lib/api.js';

/** Loads the logo with the user's token and turns it into a temporary browser URL. */
export default function useTenantLogo(hasLogo, version) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!hasLogo) {
      setUrl(null);
      return undefined;
    }
    let objectUrl = null;
    let active = true;
    api
      .get('/settings/branding/logo', { responseType: 'blob', params: { v: version } })
      .then((res) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => active && setUrl(null));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [hasLogo, version]);

  return url;
}
