import express from "express";
import multer from "multer";
import path from "path";
import { translateFile, mergeBack } from "./translator.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static("public"));

const sessions = new Map();

app.post("/upload", upload.single("file"), async (req, res) => {
  const { originalname, buffer } = req.file;
  const sessionId = Date.now().toString(36);

  try {
    sessions.set(sessionId, { status: "processing", progress: 0 });

    const inputText = buffer.toString("utf8");

    translateFile(inputText, "auto", "vi", ({ progress }) => {
      const sess = sessions.get(sessionId);
      if (sess) sess.progress = progress;
    })
      .then(({ id, result }) => {
        const merged = mergeBack(inputText, result);
        sessions.set(sessionId, {
          status: "done",
          progress: 100,
          download: `/download/${sessionId}?name=${encodeURIComponent(originalname)}`,
          merged,
        });
      })
      .catch((err) => {
        sessions.set(sessionId, { status: "error", error: err.message });
      });

    res.json({ success: true, sessionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
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

export default app; // ✅ important for Vercel
