// A self-signed HTTPS certificate, made with Node's own crypto so the app needs no OpenSSL and no
// certificate library. WebXR only runs on secure pages, so the Quest has to load Four Eyes over
// HTTPS; with a self-signed certificate it asks once to "proceed anyway" and then remembers.
//
// The certificate is a minimal X.509 v3 one: an EC P-256 key, signed with ECDSA/SHA-256, naming
// localhost, this computer and its current network addresses. It is DER-encoded by hand below.
import crypto from 'node:crypto';
import net from 'node:net';

// ----- DER (the binary encoding certificates use) -----
function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const explicit = (n, body) => tlv(0xa0 | n, body);
const octets = body => tlv(0x04, body);
const bits = body => tlv(0x03, Buffer.concat([Buffer.from([0]), body])); // 0 unused bits
const bool = v => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const utf8 = s => tlv(0x0c, Buffer.from(s, 'utf8'));
function int(buf) {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0 && !(buf[i + 1] & 0x80)) i++; // shortest form
  buf = buf.subarray(i);
  return tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf); // stay positive
}
function oid(s) {
  const [a, b, ...rest] = s.split('.').map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >>> 7; v > 0; v >>>= 7) chunk.unshift(0x80 | (v & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
// UTCTime (YYMMDDHHMMSSZ) up to 2049, GeneralizedTime after, as RFC 5280 requires
function time(d) {
  const p = n => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const rest = p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
  return y < 2050 ? tlv(0x17, Buffer.from(String(y).slice(2) + rest)) : tlv(0x18, Buffer.from(y + rest));
}

const OID = {
  ecdsaSha256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
};

function ipBytes(ip) {
  if (net.isIPv4(ip)) return Buffer.from(ip.split('.').map(Number));
  // IPv6: expand :: and write the eight 16-bit groups
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  const out = Buffer.alloc(16);
  groups.forEach((g, i) => out.writeUInt16BE(parseInt(g, 16), i * 2));
  return out;
}

const DAY = 24 * 60 * 60 * 1000;
export const CERT_DAYS = 825;

// Make a key and a self-signed certificate for these names and addresses. Returns PEM strings.
export function makeCertificate({ hosts = ['localhost'], ips = ['127.0.0.1'], days = CERT_DAYS, now = new Date() } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const name = seq(
    set(seq(oid(OID.commonName), utf8('Four Eyes Share'))),
    set(seq(oid(OID.organization), utf8('Four Eyes Share (self-signed on this PC)'))),
  );
  const alg = seq(oid(OID.ecdsaSha256));
  const serial = crypto.randomBytes(16); serial[0] &= 0x7f; serial[0] |= 0x01; // positive, never zero
  const altNames = seq(
    ...[...new Set(hosts)].map(h => tlv(0x82, Buffer.from(h, 'ascii'))), // dNSName
    ...[...new Set(ips)].map(ip => tlv(0x87, ipBytes(ip))),               // iPAddress
  );
  const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
  const extensions = seq(
    ext(OID.basicConstraints, true, seq()),                     // not a CA
    ext(OID.keyUsage, true, tlv(0x03, Buffer.from([7, 0x80]))), // digitalSignature
    ext(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
    ext(OID.subjectAltName, false, altNames),
  );
  const notBefore = new Date(now.getTime() - DAY); // a day of slack for clocks that run slow
  const notAfter = new Date(now.getTime() + days * DAY);
  const tbs = seq(
    explicit(0, int(Buffer.from([2]))), // v3
    int(serial),
    alg,
    name,
    seq(time(notBefore), time(notAfter)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, extensions),
  );
  const signature = crypto.sign('sha256', tbs, privateKey); // ECDSA signatures come out DER-encoded already
  const der = seq(tbs, alg, bits(signature));
  const pem = (label, buf) => `-----BEGIN ${label}-----\n${buf.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
  return {
    cert: pem('CERTIFICATE', der),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    notAfter: notAfter.toISOString(),
  };
}

// The SHA-256 fingerprint people can compare with what the Quest shows, in the usual AB:CD:… form.
export function fingerprint(certPem) {
  return new crypto.X509Certificate(certPem).fingerprint256;
}

// True when the certificate is missing, unreadable, or expires within a month.
export function needsNewCertificate(tls, now = new Date()) {
  if (!tls || !tls.cert || !tls.key) return true;
  try {
    const x = new crypto.X509Certificate(tls.cert);
    return new Date(x.validTo).getTime() - now.getTime() < 30 * DAY;
  } catch {
    return true;
  }
}
