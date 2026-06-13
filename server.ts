import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import router from "./src/routes";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use JSON middleware parser for API handlers
  app.use(express.json());

  console.log("Registering Express server API sub-routes on /api...");
  app.use('/api', router);


  // Vite integrated middleware setup for dev vs prod builds
  if (process.env.NODE_ENV !== "production") {
    console.log("Booting dev server with hot module replacement proxy layer...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving build artifacts inside production /dist folder...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Azam Service Desk server running securely on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Critical failure during Express server start sequence:", err);
});
