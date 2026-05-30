import cors from "cors";
import express from "express";
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { Server } from "socket.io";
import { config } from "./config.js";
import { PostgresEventRepository } from "./postgres-repository.js";
import { createApiRouter } from "./routes.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ["GET", "POST", "PATCH"],
  },
});

if (!config.databaseUrl) {
  console.error("DATABASE_URL is required for the production codebase.");
  process.exit(1);
}

const repository = await PostgresEventRepository.create(config.databaseUrl);
await repository.seedIfEmpty();

function emitEvent(event) {
  io.to(event.code).emit("event:update", event);
}

io.on("connection", (socket) => {
  socket.on("join:event", async (code) => {
    const eventCode = String(code || "").toUpperCase();
    socket.join(eventCode);
    const event = await repository.getSerializedEventByCode(eventCode);
    if (event) socket.emit("event:update", event);
  });
});

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));
app.use("/api", createApiRouter({ repository, emitEvent }));

if (fs.existsSync(config.clientDistDir)) {
  app.use(express.static(config.clientDistDir));
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(config.clientDistDir, "index.html"));
  });
}

httpServer.listen(config.apiPort, () => {
  console.log(`${config.appName} API listening on http://localhost:${config.apiPort}`);
  console.log("Database: PostgreSQL");
});
