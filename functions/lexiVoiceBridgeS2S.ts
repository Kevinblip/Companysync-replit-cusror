import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Native Speech-to-Speech Bridge for Lexi
 * 
 * This function handles true S2S by:
 * 1. Maintaining a bidirectional audio stream with Gemini Live API
 * 2. Intercepting user speech transcriptions
 * 3. Routing them through lexiChat for CRM access
 * 4. Returning enriched responses to Gemini for audio synthesis
 */

Deno.serve(async (req) => {
  console.log('🚀 Lexi S2S Bridge - Native Speech-to-Speech Mode');
  
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const mode = url.searchParams.get('mode'); // 's2s' for native mode

  if (!token) {
    return new Response('Missing token', { status: 401 });
  }

  // Verify token and get user context
  let userContext;
  try {
    // In production, you'd verify the JWT token here
    // For now, we'll decode the basic info
    const decoded = JSON.parse(atob(token.split('.')[1]));
    userContext = {
      email: decoded.email,
      companyId: decoded.companyId
    };
  } catch (e) {
    console.error('Token verification failed:', e);
    return new Response('Invalid token', { status: 401 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  // Connect to Gemini Live API
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiApiKey) {
    socket.close(1011, 'Gemini API key not configured');
    return response;
  }

  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;
  let geminiWs;

  try {
    geminiWs = new WebSocket(geminiUrl);
  } catch (e) {
    console.error('Failed to connect to Gemini:', e);
    socket.close(1011, 'Failed to connect to Gemini');
    return response;
  }

  // State management
  let isReady = false;
  const conversationHistory = [];

  // Forward client messages to Gemini
  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('📨 Client message:', Object.keys(data));

      // Forward setup and audio to Gemini
      if (data.setup || data.realtime_input) {
        if (geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.send(JSON.stringify(data));
        }
      }
    } catch (e) {
      console.error('Client message error:', e);
    }
  };

  // Process Gemini responses
  geminiWs.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('📨 Gemini message:', Object.keys(data));

      // Setup complete
      if (data.setupComplete) {
        isReady = true;
        socket.send(JSON.stringify({ setupComplete: true }));
      }

      // User speech detected - intercept for CRM processing
      if (data.serverContent?.userTurn?.parts) {
        for (const part of data.serverContent.userTurn.parts) {
          if (part.text) {
            console.log('🎤 User said:', part.text);

            // Save to history
            conversationHistory.push({
              role: 'user',
              content: part.text,
              timestamp: new Date().toISOString()
            });

            // Check if this needs CRM processing (contains keywords like "customer", "lead", "schedule", etc.)
            const needsCRM = /customer|lead|schedule|calendar|invoice|estimate|task|project|email|text/i.test(part.text);

            if (needsCRM) {
              console.log('🧠 Routing through lexiChat for CRM access...');

              // Call lexiChat to get enriched response
              try {
                const base44 = createClientFromRequest(req);
                const lexiResponse = await base44.asServiceRole.functions.invoke('lexiChat', {
                  message: part.text,
                  conversationHistory: conversationHistory.slice(-10),
                  companyId: userContext.companyId,
                  userIdentity: userContext.email,
                  mode: 'voice'
                });

                const enrichedResponse = lexiResponse.data?.response;

                if (enrichedResponse) {
                  console.log('✅ Got enriched response from lexiChat');

                  // Save assistant response to history
                  conversationHistory.push({
                    role: 'assistant',
                    content: enrichedResponse,
                    timestamp: new Date().toISOString()
                  });

                  // Send enriched response back to Gemini for TTS
                  if (geminiWs.readyState === WebSocket.OPEN) {
                    geminiWs.send(JSON.stringify({
                      client_content: {
                        turns: [{
                          role: "user",
                          parts: [{
                            text: `Say exactly this: "${enrichedResponse}"`
                          }]
                        }],
                        turn_complete: true
                      }
                    }));
                  }

                  // Don't forward the original Gemini response since we're replacing it
                  return;
                }
              } catch (e) {
                console.error('lexiChat error:', e);
                // Fall through to let Gemini respond naturally
              }
            }
          }
        }
      }

      // Forward all Gemini responses (audio, text, etc.) to client
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(event.data);
      }
    } catch (e) {
      console.error('Gemini message error:', e);
    }
  };

  geminiWs.onopen = () => {
    console.log('✅ Connected to Gemini Live API');
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ 
        system_status: 'google_connected',
        message: 'Connected to Gemini'
      }));
    }
  };

  geminiWs.onerror = (error) => {
    console.error('Gemini WebSocket error:', error);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ 
        error: 'Gemini connection error',
        details: error.message 
      }));
    }
  };

  geminiWs.onclose = (event) => {
    console.log('❌ Gemini closed:', event.code, event.reason);
    socket.close(event.code, event.reason);
  };

  socket.onclose = () => {
    console.log('❌ Client disconnected');
    if (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING) {
      geminiWs.close();
    }
  };

  return response;
});