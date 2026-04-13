const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Load .env file (no external dependencies needed)
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  envFile.split('\n').forEach(line => {
    const [key, ...val] = line.trim().split('=');
    if (key && !key.startsWith('#')) process.env[key] = val.join('=');
  });
} catch (e) { /* .env file not found — rely on system env vars */ }

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('\n❌ ERROR: GEMINI_API_KEY is not set!');
  console.error('Create a .env file with: GEMINI_API_KEY=your_key_here\n');
  process.exit(1);
}

// Fallback models — if one is rate-limited (429/503), try the next
const MODELS = [
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash'
];

function callGemini(modelName, data) {
  return new Promise((resolve, reject) => {
    const apiPath = `/v1beta/models/${modelName}:generateContent?key=${API_KEY}`;
    console.log(`[Proxy] Trying model: ${modelName}`);

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: apiPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const proxyReq = https.request(options, proxyRes => {
      let chunks = [];
      proxyRes.on('data', c => chunks.push(c));
      proxyRes.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({ statusCode: proxyRes.statusCode, headers: proxyRes.headers, body });
      });
    });

    proxyReq.on('error', e => reject(e));
    proxyReq.write(data);
    proxyReq.end();
  });
}

http.createServer(async (req, res) => {
  // Setup CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // AI Proxy endpoint with automatic retry across models
  if (req.url.startsWith('/api/gemini')) {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', async () => {
      const data = Buffer.concat(body);

      let lastResult = null;
      for (const model of MODELS) {
        try {
          const result = await callGemini(model, data);
          lastResult = result;

          if (result.statusCode === 200) {
            console.log(`[Proxy] SUCCESS with model: ${model}`);
            const headers = { ...result.headers };
            delete headers['cross-origin-opener-policy'];
            delete headers['cross-origin-resource-policy'];
            res.writeHead(200, headers);
            res.end(result.body);
            return;
          }

          // 429 = rate limited, 503 = overloaded — try next model
          if (result.statusCode === 429 || result.statusCode === 503) {
            console.log(`[Proxy] Model ${model} returned ${result.statusCode}, trying next...`);
            continue;
          }

          // Any other error (400, 404, etc) — return immediately, don't retry
          const headers = { ...result.headers };
          delete headers['cross-origin-opener-policy'];
          delete headers['cross-origin-resource-policy'];
          res.writeHead(result.statusCode, headers);
          res.end(result.body);
          return;

        } catch (e) {
          console.error(`[Proxy] Network error with ${model}:`, e.message);
          continue;
        }
      }

      // All models failed
      console.log('[Proxy] ALL models exhausted.');
      if (lastResult) {
        const headers = { ...lastResult.headers };
        delete headers['cross-origin-opener-policy'];
        delete headers['cross-origin-resource-policy'];
        res.writeHead(lastResult.statusCode, headers);
        res.end(lastResult.body);
      } else {
        res.writeHead(500);
        res.end(JSON.stringify({ error: { message: 'All AI models failed. Please wait 1 minute and try again.' } }));
      }
    });
    return;
  }

  // Serve static files
  let safeUrl = req.url === '/' ? '/ProposalDesigner (1).html' : decodeURIComponent(req.url);
  let filePath = path.join(__dirname, safeUrl);

  let extname = path.extname(filePath);
  let contentType = 'text/html';
  switch (extname) {
    case '.js': contentType = 'text/javascript'; break;
    case '.css': contentType = 'text/css'; break;
    case '.json': contentType = 'application/json'; break;
    case '.png': contentType = 'image/png'; break;
    case '.jpg': contentType = 'image/jpg'; break;
    case '.woff2': contentType = 'font/woff2'; break;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code == 'ENOENT') {
        res.writeHead(404);
        res.end(`File ${filePath} not found`);
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });

}).listen(PORT, () => {
  console.log('\n=============================================');
  console.log('  Server running successfully!');
  console.log('  Open your browser and go to:');
  console.log(`  --> http://localhost:${PORT}/`);
  console.log('=============================================\n');
});
