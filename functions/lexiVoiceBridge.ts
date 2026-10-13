// This is documentation for deploying the external bridge to Railway/Render
// DO NOT run this as a Base44 function - deploy separately to Railway.app
// 
// To deploy:
// 1. Create a new service on Railway.app or Render.com
// 2. Use Node.js runtime
// 3. Set environment variables: GEMINI_API_KEY, LEXI_VOICE_BRIDGE_SECRET
// 4. Paste the code below into server.js
// 5. Update LEXI_VOICE_BRIDGE_URL in Base44 secrets with the deployed URL

// ==================== DEPLOY THIS CODE TO RAILWAY/RENDER ====================

const { WebSocketServer } = require('ws');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BRIDGE_SECRET = process.env.LEXI_VOICE_BRIDGE_SECRET;

const wss = new WebSocketServer({ port: PORT });

function validateToken(token) {
  try {
    const [payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());

    if (decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    const hmac = crypto.createHmac('sha256', BRIDGE_SECRET);
    hmac.update(payload);
    const expectedSig = hmac.digest('base64');

    if (expectedSig !== Buffer.from(signature, 'base64').toString('base64')) {
      return null;
    }

    return decoded;
  } catch (e) {
    console.error('Token validation error:', e);
    return null;
  }
}

wss.on('connection', (clientWs, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    clientWs.close(4001, 'Missing authentication token');
    return;
  }

  const tokenData = validateToken(token);
  if (!tokenData) {
    clientWs.close(4002, 'Invalid or expired token');
    return;
  }

  console.log(`✅ Authenticated: Company ${tokenData.company_id}, User: ${tokenData.user_email}`);

  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BiDiGenerateContent?key=${GEMINI_API_KEY}`;

  let geminiWs = null;
  let isReady = false;

  try {
    geminiWs = new WebSocket(geminiUrl);

    geminiWs.on('open', () => {
      console.log(`🔗 Gemini connected for ${tokenData.company_id}`);
      isReady = true;
    });

    geminiWs.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data);
      }
    });

    geminiWs.on('close', () => {
      console.log(`❌ Gemini closed for ${tokenData.company_id}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1000, 'Gemini closed');
      }
    });

    geminiWs.on('error', (error) => {
      console.error(`Gemini error: ${error.message}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1011, 'Gemini error');
      }
    });

  } catch (error) {
    console.error('Failed to connect to Gemini:', error);
    clientWs.close(1011, 'Gemini connection failed');
    return;
  }

  clientWs.on('message', (data) => {
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN && isReady) {
      geminiWs.send(data);
    }
  });

  clientWs.on('close', () => {
    console.log(`Client disconnected: ${tokenData.company_id}`);
    if (geminiWs) geminiWs.close();
  });
});

console.log(`🚀 Lexi Voice Bridge on port ${PORT}`);