// dev-tls-proxy.js — https://adanaozelders.com.tr (443) -> http://localhost:5173
// Maske scripti baslatir/durdurur (dev-domain-maske.ps1). Bagimliliksiz:
// TLS'i mkcert sertifikasiyla (devops/certs) sonlandirir, bayt akisini Vite'a
// aynen aktarir — HTTP de WebSocket (HMR) de degismeden gecer. Vite duz http
// kalir; boylece http://localhost:5173 maskeden bagimsiz calismaya devam eder.
const tls = require("node:tls");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const certDir = path.join(__dirname, "..", "devops", "certs");
const TARGET_PORT = 5173;
const LISTEN_PORT = Number(process.env.PORT || 443);

tls
  .createServer(
    {
      cert: fs.readFileSync(path.join(certDir, "adanaozelders.pem")),
      key: fs.readFileSync(path.join(certDir, "adanaozelders-key.pem")),
    },
    (client) => {
      const upstream = net.connect(TARGET_PORT, "127.0.0.1");
      client.pipe(upstream).pipe(client);
      client.on("error", () => upstream.destroy());
      upstream.on("error", () => client.destroy());
    }
  )
  .listen(LISTEN_PORT, "127.0.0.1", () => {
    console.log(`TLS proxy hazir: https://127.0.0.1:${LISTEN_PORT} -> http://127.0.0.1:${TARGET_PORT}`);
  });
