import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadLegalPages() {
  const candidates = [
    path.resolve(__dirname, "src/lib/legalPages.cjs"),
    path.resolve(__dirname, "legalPages.cjs"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return require(file);
  }
  return null;
}

function legalPagesPlugin() {
  const legal = loadLegalPages();

  function middleware(req, res, next) {
    if (!legal) return next();
    const url = req.url?.split("?")[0] || "";
    const pageKey = legal.matchLegalRoute(url);
    if (!pageKey) return next();
    const html = legal.renderLegalHtml(pageKey);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.end(html);
  }

  return {
    name: "legal-pages",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default legalPagesPlugin;
