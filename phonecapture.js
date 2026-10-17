// "Scan with my iPhone": while it is switched on, this computer serves a tiny page on the local Wi-Fi. Open the link (or scan the QR code) on the iPhone,
// take a photo of a receipt, and the photo comes straight to the app. It is protected by a random one-time link, accepts only images, listens on the
// private network address only, and switches itself off after 15 minutes or when you press Stop. Nothing goes through the internet.
const http = require('http');
const os = require('os');
const crypto = require('crypto');

function lanAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(ifaces || {})) for (const a of list || []) {
    if (a && a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
  }
  return out;
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Send a receipt</title>
<style>body{font:17px -apple-system,system-ui,sans-serif;margin:0;padding:28px 20px;background:#f4f6fb;color:#1b2140;text-align:center}h1{font-size:22px;margin:0 0 6px}p{color:#5b6488;margin:6px 0 22px}
label{display:block;background:#3b4cf0;color:#fff;font-weight:700;border-radius:16px;padding:22px 12px;font-size:20px}#m{margin-top:22px;min-height:48px;font-weight:600}</style></head>
<body><h1>Agent X</h1><p>Take a photo of your receipt. It goes straight to your computer.</p>
<label>Take a photo of a receipt<input id="f" type="file" accept="image/*" capture="environment" hidden></label><div id="m"></div>
<script>
var m=document.getElementById('m'),n=0;
function say(t){m.textContent=t}
function shrink(file,max,cb){var img=new Image(),u=URL.createObjectURL(file);img.onload=function(){var s=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);c.toBlob(function(b){cb(b||file)},'image/jpeg',0.85)};img.onerror=function(){cb(file)};img.src=u}
document.getElementById('f').onchange=function(){var f=this.files[0];this.value='';if(!f)return;say('Sending\\u2026');
  shrink(f,1800,function(b){fetch(location.pathname.replace(/\\/$/,'')+'/up',{method:'POST',headers:{'Content-Type':b.type||'image/jpeg'},body:b}).then(function(r){return r.json()}).then(function(j){if(j.ok){n++;say('Sent \\u2713 ('+n+'). Check your computer. Take another if you like.')}else say(j.error||'Could not send.')}).catch(function(){say('Could not reach your computer. Is it still on the same Wi-Fi?')})})};
</script></body></html>`;

const MAGIC = (b) => (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png' : b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : '');

function createPhoneCapture({ onImage, qr, addresses = lanAddresses, maxBytes = 12 * 1024 * 1024, ttlMs = 15 * 60 * 1000, maxImages = 60, now = Date.now }) {
  let server = null, token = '', expires = 0, timer = null, got = 0, bad = 0, url = '';
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const okToken = (t) => { const a = Buffer.from(String(t)), b = Buffer.from(token); return a.length === b.length && crypto.timingSafeEqual(a, b); };
  function stop() { if (timer) clearTimeout(timer); timer = null; if (server) { try { server.close(); server.closeAllConnections && server.closeAllConnections(); } catch (e) { /* already closed */ } } server = null; token = ''; url = ''; expires = 0; }
  function handler(req, res) {
    const m = /^\/r\/([0-9a-f]{32})(\/up)?\/?$/.exec((req.url || '').split('?')[0]);
    if (!m || !token || now() > expires || !okToken(m[1])) { if (++bad > 50) stop(); res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer');
    if (req.method === 'GET' && !m[2]) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src blob: data:" });
      res.end(PAGE); return;
    }
    if (req.method === 'POST' && m[2]) {
      if (got >= maxImages) return json(res, 429, { ok: false, error: 'That is enough receipts for now.' });
      const chunks = []; let size = 0, dead = false;
      req.on('data', (c) => { if (dead) return; size += c.length; if (size > maxBytes) { dead = true; chunks.length = 0; res.setHeader('connection', 'close'); json(res, 413, { ok: false, error: 'That photo is too big.' }); } else chunks.push(c); });   // the rest of the body is read and thrown away
      req.on('end', () => {
        if (dead) return;
        const buf = Buffer.concat(chunks), type = MAGIC(buf);
        if (!type) return json(res, 415, { ok: false, error: 'That does not look like a photo.' });
        got++;
        try { onImage({ buf, type }); } catch (e) { return json(res, 500, { ok: false, error: 'The app could not take that photo.' }); }
        json(res, 200, { ok: true });
      });
      req.on('error', () => { /* connection dropped */ });
      return;
    }
    res.writeHead(405, { 'content-type': 'text/plain' }); res.end('No');
  }
  return {
    async start() {
      stop();
      const addrs = addresses();
      if (!addrs.length) throw new Error('This computer is not on a Wi-Fi or local network, so the phone cannot reach it. Connect to the same Wi-Fi as your phone.');
      token = crypto.randomBytes(16).toString('hex'); got = 0; bad = 0; expires = now() + ttlMs;
      server = http.createServer(handler);
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, addrs[0], resolve); });
      url = 'http://' + addrs[0] + ':' + server.address().port + '/r/' + token;
      timer = setTimeout(stop, ttlMs); if (timer.unref) timer.unref();
      return { url, qr: qr ? qr(url) : '', expires };
    },
    stop,
    status() { return { on: !!server, url, expires, received: got }; },
  };
}

module.exports = { createPhoneCapture, lanAddresses, MAGIC };
