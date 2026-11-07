import { WebSocketServer } from 'ws';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { handleSalesRequest } = nodeRequire('./lib/salesAgent/http.cjs');
const { attachSalesDemoClient } = nodeRequire('./lib/salesAgent/bridge.cjs');
const { attachSalesPhoneClient } = nodeRequire('./lib/salesAgent/phoneBridge.cjs');
const { startSalesAgentScheduler } = nodeRequire('./lib/salesAgent/scheduler.cjs');

export default function salesDemoPlugin() {
  return {
    name: 'sales-demo',
    configureServer(server) {
      startSalesAgentScheduler();
      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await handleSalesRequest(req, res);
          if (!handled) next();
        } catch (err) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'sales request failed' }));
          }
        }
      });

      const wss = new WebSocketServer({ noServer: true });
      const phoneWss = new WebSocketServer({ noServer: true });
      server.httpServer.on('upgrade', (req, socket, head) => {
        if (req.url && req.url.startsWith('/ws/sales-demo')) {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
          });
        } else if (req.url && req.url.startsWith('/ws/sales-phone')) {
          phoneWss.handleUpgrade(req, socket, head, (ws) => {
            phoneWss.emit('connection', ws, req);
          });
        }
      });
      wss.on('connection', (ws, req) => attachSalesDemoClient(ws, req));
      phoneWss.on('connection', (ws, req) => attachSalesPhoneClient(ws, req));
      console.log('[SalesDemo] WebSocket endpoints: /ws/sales-demo /ws/sales-phone');
    },
  };
}
