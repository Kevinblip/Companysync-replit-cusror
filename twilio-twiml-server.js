import http from 'http';
import { URL } from 'url';

const GEMINI_STREAM_URL = 'wss://getcompanysync.com/api/functions/geminiLiveCallStream?companyId=695944e3c1fb00b7ab716c6f';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (url.pathname === '/voice' || url.pathname === '/') {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${GEMINI_STREAM_URL}">
            <Parameter name="companyId" value="695944e3c1fb00b7ab716c6f" />
        </Stream>
    </Connect>
</Response>`;
    
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
    console.log(`[${new Date().toISOString()}] Served TwiML to Twilio`);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(3001, '0.0.0.0', () => {
  console.log('TwiML server running on port 3001');
});
