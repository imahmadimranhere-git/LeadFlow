// SMTP with the company's own mailbox. The host is tenant-supplied → we resolve it ourselves, refuse
// internal addresses (SSRF) and connect to the checked IP, with TLS checked against the real host name.
import { validateUrl } from '../../utils/safeFetch.js';

const TIMEOUT_MS = 20_000;

// Tests replace the transport factory (no real mail server in automated tests)
let factory = null;
export function setMailTransportFactory(fn) {
  factory = fn;
}

export async function createSmtpTransport(secrets, config) {
  if (factory) return factory(secrets, config);
  const target = await validateUrl(`http://${config.host}/`); // throws SafeFetchError for private/internal hosts
  const nodemailer = (await import('nodemailer')).default;
  const port = Number(config.port);
  return nodemailer.createTransport({
    host: target.address,
    port,
    secure: port === 465,
    requireTLS: port !== 465, // never send the password over an unencrypted connection
    auth: { user: config.username, pass: secrets.password },
    tls: { servername: config.host },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
}
