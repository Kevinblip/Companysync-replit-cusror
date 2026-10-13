import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import WebSocket from 'npm:ws';

/**
 * OPENAI REALTIME RELAY - DIAGNOSTIC VERSION
 * Includes REST diagnosis to verify API Key and Connectivity.
 */

Deno.serve(async (req) => {
    try {
        const url = new URL(req.url);
        const mode = url.searchParams.get("mode");

        // CORS Preflight
        if (req.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Upgrade, Connection"
                }
            });
        }

        // 1. HEALTH CHECK
        if (mode === 'health') {
            return Response.json({ status: "ok", service: "openai-realtime-relay" });
        }

        // 2. DIAGNOSIS MODE
        if (mode === 'diagnose') {
            const envKey = Deno.env.get("Open_AI_Api_Key") || Deno.env.get("OPENAI_API_KEY");
            const apiKey = (envKey || "").trim();
            const keySource = envKey ? "Environment Variable" : "NONE";

            if (!apiKey) {
                return Response.json({ error: "Missing API Key", details: "No environment variable found for Open_AI_Api_Key" });
            }

            try {
                console.log("[OpenAI Relay] Running REST Diagnosis...");
                // Test API Key by listing models (simple GET request)
                const resp = await fetch("https://api.openai.com/v1/models", {
                    headers: { "Authorization": `Bearer ${apiKey}` }
                });

                const data = await resp.json();

                // Check if our target model exists
                const targetModel = "gpt-4o-realtime-preview";
                const hasModel = data.data?.some(m => m.id.includes(targetModel)) || false;

                return Response.json({
                    key_source: keySource,
                    key_preview: `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`,
                    http_status: resp.status,
                    can_reach_openai: resp.ok,
                    valid_key: resp.ok,
                    target_model_available: hasModel,
                    available_models_sample: data.data?.slice(0, 5).map(m => m.id),
                    error_details: resp.ok ? null : data
                });
            } catch (e) {
                return Response.json({ 
                    error: "Network/System Error", 
                    details: e.message 
                });
            }
        }

        const upgradeHeader = req.headers.get("upgrade") || "";

        // 3. WEBSOCKET UPGRADE
        if (upgradeHeader.toLowerCase() === "websocket") {
            try {
                console.log("[OpenAI Relay] Upgrading client connection...");
                const { socket: clientWs, response } = Deno.upgradeWebSocket(req);
                
                // Allow CORS on upgrade response (Deno handles this, but good for clarity)
                // Note: Deno.upgradeWebSocket response is immutable regarding headers in some versions, 
                // but usually works fine.
                
                clientWs.onopen = () => {
                    console.log("[OpenAI Relay] Client Connected");
                    connectToOpenAI(clientWs);
                };

                clientWs.onerror = (e) => console.error("[OpenAI Relay] Client Error:", e);
                
                return response;
            } catch (err) {
                console.error("[OpenAI Relay] Upgrade Failed:", err);
                return Response.json({ error: err.message }, { status: 500 });
            }
        }

        // Default Response
        return Response.json({ 
            message: "OpenAI Realtime Relay. Use ?mode=diagnose to test connection." 
        });

    } catch (err) {
        console.error("[OpenAI Relay] Critical Error:", err);
        return new Response("Internal Server Error", { status: 500 });
    }
});

function connectToOpenAI(clientWs) {
    try {
        const apiKey = (Deno.env.get("Open_AI_Api_Key") || Deno.env.get("OPENAI_API_KEY") || "").trim();
        
        if (!apiKey) {
            console.error("[OpenAI Relay] Missing API Key");
            clientWs.close(1008, "Missing API Key on Server");
            return;
        }

        // Use the generic alias which usually points to the latest stable preview
        // Or specific: gpt-4o-realtime-preview-2024-10-01
        const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview";
        
        console.log(`[OpenAI Relay] Connecting to OpenAI (${url})...`);
        
        const openaiWs = new WebSocket(url, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "OpenAI-Beta": "realtime=v1",
            },
        });

        // --- OpenAI Events ---

        openaiWs.on("open", () => {
            console.log("[OpenAI Relay] ✅ Connected to OpenAI");
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "system", status: "connected" }));
            }
        });

        openaiWs.on("message", (data) => {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(data.toString());
            }
        });

        openaiWs.on("close", (code, reason) => {
            console.log(`[OpenAI Relay] OpenAI Closed: ${code} ${reason}`);
            if (clientWs.readyState === WebSocket.OPEN) {
                // OpenAI often closes with 1000 (normal) or others.
                // We forward the close to the client.
                clientWs.close(1000, "OpenAI closed connection");
            }
        });

        openaiWs.on("error", (error) => {
            console.error("[OpenAI Relay] OpenAI Socket Error:", error);
            if (clientWs.readyState === WebSocket.OPEN) {
                try {
                    clientWs.send(JSON.stringify({ 
                        type: "error", 
                        error: { message: "OpenAI Upstream Error" } 
                    }));
                    clientWs.close(1011, "OpenAI Error");
                } catch (e) { /* ignore */ }
            }
        });

        openaiWs.on("unexpected-response", (req, res) => {
            console.error(`[OpenAI Relay] Unexpected: ${res.statusCode} ${res.statusMessage}`);
            
            // This is the most common cause of 1006 on the client
            // We can try to send a text frame before closing, explaining the error
            if (clientWs.readyState === WebSocket.OPEN) {
                try {
                    // Send a clear error message as JSON
                    clientWs.send(JSON.stringify({
                        type: "error",
                        error: { 
                            message: `OpenAI Handshake Failed: ${res.statusCode} ${res.statusMessage}. Check API Key.` 
                        }
                    }));
                    // Then close
                    clientWs.close(1008, `Upstream ${res.statusCode}`);
                } catch (e) { /* ignore */ }
            }
        });

        // --- Client Events ---

        clientWs.onmessage = (e) => {
            if (openaiWs.readyState === WebSocket.OPEN) {
                openaiWs.send(e.data);
            }
        };

        clientWs.onclose = () => {
            console.log("[OpenAI Relay] Client Closed");
            if (openaiWs.readyState === WebSocket.OPEN) {
                openaiWs.close();
            }
        };

    } catch (err) {
        console.error("[OpenAI Relay] Logic Error:", err);
        clientWs.close(1011, "Internal Relay Logic Error");
    }
}