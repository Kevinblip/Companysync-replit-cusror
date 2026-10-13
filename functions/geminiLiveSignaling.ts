import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * GEMINI PROXY - DENO VERSION
 * Bridges clients to Google Gemini 2.0 Live API
 */

const MANUAL_API_KEY = ""; 
const ENV_KEY_1 = "GEMINI_API_KEY";
const ENV_KEY_2 = "GOOGLE_GEMINI_API_KEY";
const ENV_KEY_3 = "GEMINI_API_KEY_COMPANYSYNC_VOICE";

Deno.serve(async (req) => {
    // CORS
    if (req.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Upgrade, Connection, Authorization"
            }
        });
    }

    const url = new URL(req.url);
    const mode = url.searchParams.get("mode");
    
    console.log('[Proxy] Request:', req.method, url.pathname, 'Mode:', mode, 'Upgrade:', req.headers.get("upgrade"));

    // KEY DETECTION
    const envKey = Deno.env.get(ENV_KEY_1) || Deno.env.get(ENV_KEY_2) || Deno.env.get(ENV_KEY_3);
    const activeKey = (MANUAL_API_KEY || envKey || "").trim();
    const keySource = MANUAL_API_KEY ? "Manual Paste" : (envKey ? `Environment Variable (${Deno.env.get(ENV_KEY_1) ? 'GEMINI_API_KEY' : Deno.env.get(ENV_KEY_2) ? 'GOOGLE_GEMINI_API_KEY' : 'GEMINI_API_KEY_COMPANYSYNC_VOICE'})` : "NONE FOUND");

    // DIAGNOSIS MODE
    if (mode === 'diagnose') {
        if (!activeKey) {
            return Response.json({ 
                error: "No API Key Found", 
                details: "You must either paste your key into the code or set the environment variables." 
            });
        }
        try {
            console.log(`[Proxy] Testing Key: ${keySource} (Length: ${activeKey.length})`);
            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${activeKey}`);
            const data = await resp.json();
            
            const errorMsg = data.error ? `${data.error.code} - ${data.error.message}` : (resp.ok ? null : `HTTP ${resp.status}`);

            return Response.json({
                key_source: keySource,
                key_preview: `${activeKey.slice(0, 4)}...${activeKey.slice(-4)}`,
                rest_api_status: resp.status,
                status_message: errorMsg || "OK",
                has_gemini_2: data.models?.some(m => m.name.includes("gemini-2.0")) ? "Yes" : "No",
                raw_response: data,
                google_error: data.error
            });
        } catch (e) {
            console.error("[Proxy] Diagnosis Network Error:", e);
            return Response.json({ error: "Network Error", message: e.message });
        }
    }

    // WEBSOCKET LOGIC
    const upgradeHeader = req.headers.get("upgrade") || "";
    if (upgradeHeader.toLowerCase() === "websocket") {
        
        try {
            const { socket: clientWs, response } = Deno.upgradeWebSocket(req);

            clientWs.onopen = () => {
                console.log('[Proxy] Client WS opened, Key source:', keySource, 'Has key:', !!activeKey);
                
                if (!activeKey) {
                    console.error("[Proxy] Cannot connect: No API Key");
                    clientWs.send(JSON.stringify({ error: "No API Key configured on backend" }));
                    clientWs.close(1008, "Proxy has no API Key configured");
                    return;
                }

                // Connect to Gemini 2.0 Flash (Multimodal Live API)
                const targetUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${activeKey}`;
                console.log('[Proxy] Connecting to Google with key from:', keySource);
                const googleWs = new WebSocket(targetUrl);
                
                let googleConnected = false;
                let googleConnectionTimeout = null;

                googleWs.onopen = () => {
                    console.log("[Proxy] ✅ Connected to Google Gemini API");
                    console.log("[Proxy] Key preview:", `${activeKey.slice(0, 8)}...${activeKey.slice(-4)}`);
                    console.log("[Proxy] Key length:", activeKey.length);
                    
                    googleConnected = true;
                    if (googleConnectionTimeout) {
                        clearTimeout(googleConnectionTimeout);
                        googleConnectionTimeout = null;
                    }
                    
                    if (clientWs.readyState === WebSocket.OPEN) {
                        console.log("[Proxy] Notifying client of Google connection...");
                        clientWs.send(JSON.stringify({ 
                            system_status: "google_connected",
                            timestamp: new Date().toISOString()
                        }));
                    }
                };

                // Set timeout to detect if Google connection stalls
                googleConnectionTimeout = setTimeout(() => {
                    if (!googleConnected && clientWs.readyState === WebSocket.OPEN) {
                        console.error("[Proxy] ⏰ Google connection timeout - no response within 5s");
                        clientWs.send(JSON.stringify({
                            error: "Google connection timeout",
                            system_status: "error"
                        }));
                        clientWs.close(1011, "Google connection timeout");
                        if (googleWs.readyState !== WebSocket.CLOSED) {
                            googleWs.close();
                        }
                    }
                }, 5000);

                googleWs.onmessage = (e) => {
                    try {
                        // Log Google's response
                        let logData;
                        try {
                            logData = JSON.parse(e.data);
                            if (logData.serverContent?.setupComplete) {
                                console.log("[Proxy] ✅ Google confirmed setup complete");
                            }
                            if (logData.serverContent?.usageMetadata?.inputTokenCount) {
                                console.log("[Proxy] Google message with tokens:", logData.serverContent.usageMetadata.inputTokenCount);
                            }
                            // Log ANY error from Google
                            if (logData.serverContent?.setup_error || logData.error) {
                                console.error("[Proxy] ⚠️ GOOGLE ERROR IN MESSAGE:", JSON.stringify(logData, null, 2));
                            }
                        } catch (parseErr) {
                            // Not JSON, probably binary
                        }

                        if (clientWs.readyState === WebSocket.OPEN) {
                            clientWs.send(e.data);
                        }
                    } catch (err) {
                        console.error("[Proxy] Error forwarding Google message:", err);
                    }
                };

                googleWs.onclose = (e) => {
                    console.log(`[Proxy] 🔴 Google Closed IMMEDIATELY`);
                    console.log(`[Proxy] Close Code: ${e.code}`);
                    console.log(`[Proxy] Close Reason: ${e.reason || "(EMPTY)"}`);
                    console.log(`[Proxy] Was connected after onopen: ${googleConnected}`);
                    console.log(`[Proxy] Time since onopen: ${googleConnected ? "less than 100ms" : "never reached onopen"}`);
                    
                    // Close codes: 1000=ok, 1002=protocol, 1008=policy, 1011=server error
                    const errorMap = {
                        1002: "Protocol error - malformed setup JSON",
                        1008: "Policy violation - invalid/unsupported field",
                        1011: "Server error - setup rejected"
                    };
                    
                    console.error(`[Proxy] ❌ ERROR CODE ${e.code}: ${errorMap[e.code] || "Connection rejected"}`);
                    console.log(`[Proxy] 💡 POSSIBLE ISSUES:`);
                    console.log(`    - Model name might be wrong (check if "gemini-2.0-flash-exp" exists)`);
                    console.log(`    - response_modalities format (should be array? ["audio"])`);
                    console.log(`    - Missing required fields in setup`);
                    console.log(`    - Invalid speech config structure`);
                    
                    if (googleConnectionTimeout) {
                        clearTimeout(googleConnectionTimeout);
                    }
                    
                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({
                            system_status: "google_disconnected",
                            code: e.code,
                            reason: e.reason || "(no reason provided)",
                            error_type: errorMap[e.code] || "unknown",
                            hint: "Check Railway logs for setup message details above"
                        }));
                        clientWs.close(1000, `Google rejected: ${e.code}`);
                    }
                };

                googleWs.onerror = (e) => {
                    console.error("[Proxy] 🔴 Google Error Event:", e);
                    console.error("[Proxy] Error message:", e.message || String(e));
                    console.error("[Proxy] Error code:", e.code);

                    if (googleConnectionTimeout) {
                        clearTimeout(googleConnectionTimeout);
                    }

                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({ 
                            error: "Google WebSocket error", 
                            details: e.message || String(e),
                            system_status: "error",
                            google_error: e
                        }));
                        clientWs.close(1011, "Google error");
                    }
                };

                clientWs.onmessage = (e) => {
                    try {
                        // Log setup messages for debugging
                        if (typeof e.data === 'string') {
                            try {
                                const msg = JSON.parse(e.data);
                                if (msg.setup) {
                                    console.log("[Proxy] 📤 CLIENT SENDING SETUP:");
                                    console.log(JSON.stringify(msg, null, 2));
                                    console.log("[Proxy] ⚠️ SETUP DETAILS:");
                                    console.log("  - Model:", msg.setup.model);
                                    console.log("  - Response modalities:", msg.setup.generation_config?.response_modalities);
                                    console.log("  - Has system_instruction:", !!msg.setup.system_instruction);
                                    console.log("  - Has speech_config:", !!msg.setup.generation_config?.speech_config);
                                }
                            } catch (p) {}
                        }
                        
                        if (googleWs.readyState === WebSocket.OPEN) {
                            console.log("[Proxy] Forwarding message to Google, Google state:", googleWs.readyState);
                            googleWs.send(e.data);
                        } else {
                            console.warn("[Proxy] 🚫 Google WS not open (state:", googleWs.readyState, "), dropping message");
                        }
                    } catch (err) {
                        console.error("[Proxy] Error sending to Google:", err);
                    }
                };

                clientWs.onclose = () => {
                    console.log("[Proxy] Client WS closed");
                    if (googleConnectionTimeout) {
                        clearTimeout(googleConnectionTimeout);
                    }
                    if (googleWs.readyState === WebSocket.OPEN || googleWs.readyState === WebSocket.CONNECTING) {
                        googleWs.close();
                    }
                };
            };

            return response;

        } catch (err) {
            console.error("[Proxy] Upgrade Failed:", err);
            return new Response("WebSocket Upgrade Failed", { status: 500 });
        }
    }

    // Default Response (JSON for health checks)
    return Response.json({ 
        status: "ok",
        service: "gemini-proxy",
        message: "Gemini Proxy Active. Use ?mode=diagnose to test key.",
        env: {
            has_general_key: !!activeKey,
            has_voice_key: !!activeKey
        }
    });
});