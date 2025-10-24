import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { translateFile, mergeBack } from "./translator.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Serve static files inside Express (important for / to work)
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

const sessions = new Map();

app.post("/upload", upload.single("file"), async (req, res) => {
  const { originalname, buffer } = req.file;
  const sessionId = Date.now().toString(36);
  const inputText = buffer.toString("utf8");

  sessions.set(sessionId, { status: "processing", progress: 0 });

  translateFile(inputText, "auto", "vi", ({ progress }) => {
    const sess = sessions.get(sessionId);
    if (sess) sess.progress = progress;
  })
    .then(({ id, result }) => {
      const merged = mergeBack(inputText, result);
      sessions.set(sessionId, {
        status: "done",
        progress: 100,
        merged,
        download: `/download/${sessionId}?name=${encodeURIComponent(originalname)}`
      });
    })
    .catch((err) => {
      sessions.set(sessionId, { status: "error", error: err.message });
    });

  res.json({ success: true, sessionId });
});

app.get("/progress/:id", (req, res) => {
  const sess = sessions.get(req.params.id);
  if (!sess) return res.json({ status: "notfound" });
  res.json(sess);
});

app.get("/download/:id", (req, res) => {
  const sess = sessions.get(req.params.id);
  if (!sess || sess.status !== "done") return res.status(404).send("Not ready");
  const filename =
    req.query.name?.replace(/\.rpy$/, "") + "-translated.rpy" || "translated.rpy";
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(sess.merged);
});

// ✅ Important: Export app (don't start a server)
export default app;
