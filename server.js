import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { translateFile, mergeBack } from "./translator.js";

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = 3000;

app.use(express.static("public"));
app.use("/dist", express.static("dist"));

const sessions = new Map();

app.post("/upload", upload.single("file"), async (req, res) => {
  const filePath = req.file.path;
  const originalName = req.file.originalname;
  const sessionId = path.basename(filePath);

  try {
    sessions.set(sessionId, { status: "processing", progress: 0, filePath });

    translateFile(filePath, "auto", "vi", ({ progress }) => {
      const sess = sessions.get(sessionId);
      if (sess) sess.progress = progress;
    })
      .then(({ id, result }) => {
        const merged = mergeBack(filePath, result);
        const outputPath = `dist/${id}-translated${path.extname(originalName)}`;
        fs.writeFileSync(outputPath, merged);
        sessions.set(sessionId, { status: "done", progress: 100, download: `/dist/${path.basename(outputPath)}` });
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

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
