import express, { Request, Response, NextFunction } from "express";
import groqService from "./services/groqService";
import firebaseService from "./services/firebaseService";
import clarityService from "./services/clarityService";

const app: express.Application = express();

// Middleware
app.use(express.json({ limit: "10mb" }));

// Enable CORS
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

app.get("/", (req: Request, res: Response) => {
  res.json({
    status: "online",
    message: "Live Audio Transcription, Groq AI & Firebase Database API",
    endpoints: {
      analyze: "POST /api/analyze",
      save: "POST /api/save",
      meetings: "GET /api/meetings",
      clarityEnhance: "POST /api/clarity/enhance",
      clarityAsk: "POST /api/clarity/ask",
      clarityState: "GET /api/clarity/state",
    }
  });
});

// Endpoint to analyze raw meeting transcript with Groq API
app.post("/api/analyze", (req: Request, res: Response) => {
  const { transcript } = req.body;
  if (!transcript || typeof transcript !== "string") {
    res.status(400).json({ error: "Missing or invalid 'transcript' string in request body." });
    return;
  }

  console.log("Analyzing transcript with Groq API...");
  groqService
    .analyzeTranscript(transcript)
    .then((analysis) => {
      res.json({ success: true, analysis });
    })
    .catch((error) => {
      console.error("Error in /api/analyze:", error);
      res.status(500).json({ error: "Failed to analyze transcript", details: error?.message });
    });
});

// Endpoint to save meeting transcript and analysis to Firebase Database
app.post("/api/save", (req: Request, res: Response) => {
  const { title, rawTranscript, analysis, source } = req.body;
  if (!rawTranscript) {
    res.status(400).json({ error: "Missing 'rawTranscript' in request body." });
    return;
  }

  const processSave = async () => {
    let finalAnalysis = analysis;
    if (!finalAnalysis) {
      finalAnalysis = await groqService.analyzeTranscript(rawTranscript);
    }
    return await firebaseService.saveMeeting({
      title,
      rawTranscript,
      analysis: finalAnalysis,
      source,
    });
  };

  processSave()
    .then((result) => {
      res.json(result);
    })
    .catch((error) => {
      console.error("Error in /api/save:", error);
      res.status(500).json({ error: "Failed to save meeting record", details: error?.message });
    });
});

// Endpoint to retrieve saved meetings from Firebase
app.get("/api/meetings", (req: Request, res: Response) => {
  firebaseService
    .getMeetings()
    .then((meetings) => {
      res.json({ success: true, count: meetings.length, meetings });
    })
    .catch((error) => {
      console.error("Error in /api/meetings:", error);
      res.status(500).json({ error: "Failed to fetch meeting records", details: error?.message });
    });
});

// LIVE CLARITY LAYER ENDPOINTS
// 1. Streaming rolling chunk enhancement & auto question detection
app.post("/api/clarity/enhance", async (req: Request, res: Response) => {
  const { rawChunk, speaker } = req.body;
  if (!rawChunk || typeof rawChunk !== "string") {
    res.status(400).json({ error: "Missing or invalid 'rawChunk' string in request body." });
    return;
  }

  try {
    const result = await clarityService.enhanceTranscriptChunk(rawChunk, speaker || "Speaker 1");
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error("Error in /api/clarity/enhance:", error);
    res.status(500).json({ error: "Failed to enhance transcript chunk", details: error?.message });
  }
});

// 2. Typed question submission from UI sidebar
app.post("/api/clarity/ask", async (req: Request, res: Response) => {
  const { question, speaker } = req.body;
  if (!question || typeof question !== "string") {
    res.status(400).json({ error: "Missing or invalid 'question' string in request body." });
    return;
  }

  try {
    const questionItem = await clarityService.detectAndAnswerQuestion(question, true, speaker || "You (Typed)");
    res.json({ success: true, question: questionItem });
  } catch (error: any) {
    console.error("Error in /api/clarity/ask:", error);
    res.status(500).json({ error: "Failed to process question", details: error?.message });
  }
});

// 3. Retrieve Live Clarity Layer running state
app.get("/api/clarity/state", (req: Request, res: Response) => {
  try {
    const state = clarityService.getState();
    res.json({ success: true, ...state });
  } catch (error: any) {
    console.error("Error in /api/clarity/state:", error);
    res.status(500).json({ error: "Failed to get clarity state", details: error?.message });
  }
});

// 4. Reset Live Clarity Layer state for new meeting transcript session
app.post("/api/clarity/reset", (req: Request, res: Response) => {
  try {
    clarityService.resetState();
    res.json({ success: true, message: "Clarity layer state reset successfully." });
  } catch (error: any) {
    console.error("Error in /api/clarity/reset:", error);
    res.status(500).json({ error: "Failed to reset clarity state", details: error?.message });
  }
});

export default app;
