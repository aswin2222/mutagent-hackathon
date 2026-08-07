import { useEffect, useRef, useState } from "react";
import useAudioCapture from "./hooks/useAudioCapture";
import useWebSocketConnection from "./hooks/useWebSocketConnection";
import { LiveClarityView, EnhancedLine, QuestionItem, UnresolvedActionItem } from "./components/LiveClarityView";
import "./App.css";

interface TaskItem {
  task: string;
  assignee?: string;
  priority?: string;
}

interface DeadlineItem {
  item: string;
  dueDate: string;
}

interface MeetingAnalysis {
  summary: string;
  keyInsights: string[];
  tasks: TaskItem[];
  deadlines: DeadlineItem[];
}

interface MeetingRecord {
  id: string;
  title: string;
  timestamp: string;
  rawTranscript: string;
  analysis: MeetingAnalysis;
  source: string;
}

function App(): JSX.Element {
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"transcript" | "clarity" | "ai" | "history">("clarity");
  const [analysis, setAnalysis] = useState<MeetingAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusNotification, setStatusNotification] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [savedMeetings, setSavedMeetings] = useState<MeetingRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [selectedRecord, setSelectedRecord] = useState<MeetingRecord | null>(null);

  // Live Clarity Layer State
  const [enhancedLines, setEnhancedLines] = useState<EnhancedLine[]>([]);
  const [clarityQuestions, setClarityQuestions] = useState<QuestionItem[]>([]);
  const [unresolvedActionItems, setUnresolvedActionItems] = useState<UnresolvedActionItem[]>([]);
  const [isProcessingQuestion, setIsProcessingQuestion] = useState<boolean>(false);

  const [localTranscripts, setLocalTranscripts] = useState<string[]>([]);
  const [interimTranscript, setInterimTranscript] = useState<string>("");
  const clarityProcessedCountRef = useRef<number>(0);

  const transcriptionAreaRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  const AUDIO_CAPTURE_INTERVAL_MS: number = 1000;
  const WEB_SOCKET_URL: string = "ws://localhost:8080";
  const SERVER_API_URL: string = "http://localhost:3000";

  const { messageHistory, connectionStatus, sendAudioChunk } =
    useWebSocketConnection(
      WEB_SOCKET_URL,
      autoScroll,
      transcriptRef,
      transcriptionAreaRef
    );
  // Restore background recording status and transcripts when extension popup reopens
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      chrome.storage.local.get(["isRecording", "savedTranscripts"], (result: any) => {
        if (result.isRecording) {
          setIsCapturing(true);
        }
        if (result.savedTranscripts && Array.isArray(result.savedTranscripts)) {
          setLocalTranscripts(result.savedTranscripts);
          clarityProcessedCountRef.current = result.savedTranscripts.length;
        }
      });
    } else {
      const isRec = localStorage.getItem("isRecording") === "true";
      if (isRec) setIsCapturing(true);
      const saved = localStorage.getItem("savedTranscripts");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setLocalTranscripts(parsed);
          clarityProcessedCountRef.current = parsed.length;
        } catch (_e) { /* ignore parse errors */ }
      }
    }

    // Listen for background transcript messages from offscreen worker
    if (typeof chrome !== "undefined" && chrome?.runtime?.onMessage) {
      const handleBgMessage = (message: any) => {
        if (message.action === "NEW_TRANSCRIPT") {
          if (message.isFinal && message.text) {
            setLocalTranscripts((prev) => {
              if (prev.length > 0 && prev[prev.length - 1] === message.text) return prev;
              const next = [...prev, message.text];
              if (typeof chrome !== "undefined" && chrome?.storage?.local) {
                chrome.storage.local.set({ savedTranscripts: next });
              } else {
                localStorage.setItem("savedTranscripts", JSON.stringify(next));
              }
              return next;
            });
            setInterimTranscript("");
          } else if (!message.isFinal && message.text) {
            setInterimTranscript(message.text);
          }
        }
      };
      chrome.runtime.onMessage.addListener(handleBgMessage);
      return () => { chrome.runtime.onMessage.removeListener(handleBgMessage); };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLocalTranscript = (text: string, isFinal: boolean) => {
    if (isFinal && text.trim()) {
      const formatted = text.match(/^(Speaker\s*\d+|Participant|You \(Typed\)):/i)
        ? text.trim()
        : `Speaker 2: ${text.trim()}`;
      setLocalTranscripts((prev) => {
        if (prev.length > 0 && prev[prev.length - 1] === formatted) return prev;
        return [...prev, formatted];
      });
      setInterimTranscript("");
    } else {
      setInterimTranscript(text);
    }
  };

  const { startCapture, stopCapture } = useAudioCapture(
    AUDIO_CAPTURE_INTERVAL_MS,
    setIsCapturing,
    sendAudioChunk,
    handleLocalTranscript
  );

  const handleCaptureToggle = async () => {
    if (isCapturing) {
      stopCapture();
      setInterimTranscript("");
    } else {
      startCapture();
    }
  };

  // Automatically feed incoming WebSocket transcripts from Deepgram into localTranscripts
  useEffect(() => {
    if (messageHistory.length > 0) {
      const lastMsg = messageHistory[messageHistory.length - 1];
      let rawData = typeof lastMsg.data === "string" ? lastMsg.data.trim() : "";
      if (!rawData) return;

      let text = rawData;
      let isFinal = true;

      if (rawData.startsWith("{")) {
        try {
          const parsed = JSON.parse(rawData);
          text = parsed.text || rawData;
          isFinal = parsed.isFinal !== undefined ? Boolean(parsed.isFinal) : true;
        } catch (_e) {
          text = rawData;
        }
      }

      if (text.startsWith("Deepgram Live Transcript:")) {
        text = text.replace("Deepgram Live Transcript:", "").trim();
      }

      if (text) {
        if (!isFinal) {
          setInterimTranscript(text);
        } else {
          setInterimTranscript("");
          setLocalTranscripts((prev) => {
            // If the last item was an interim/partial prefix of this final line, replace it
            if (prev.length > 0) {
              const last = prev[prev.length - 1];
              if (last === text || text.startsWith(last)) {
                const updated = [...prev];
                updated[updated.length - 1] = text;
                return updated;
              }
            }
            const next = [...prev, text];
            if (typeof chrome !== "undefined" && chrome?.storage?.local) {
              chrome.storage.local.set({ savedTranscripts: next });
            } else {
              localStorage.setItem("savedTranscripts", JSON.stringify(next));
            }
            return next;
          });
        }
      }
    }
  }, [messageHistory]);

  // Reactive clarity pipeline: whenever localTranscripts grows, feed new entries to the clarity API
  useEffect(() => {
    const newCount = localTranscripts.length;
    const alreadyProcessed = clarityProcessedCountRef.current;
    if (newCount > alreadyProcessed) {
      const newEntries = localTranscripts.slice(alreadyProcessed);
      clarityProcessedCountRef.current = newCount;
      newEntries.forEach((chunk) => {
        if (chunk && chunk.trim()) {
          sendToClarityApi(chunk, "Speaker 1");
        }
      });
    }
  }, [localTranscripts]);

  const sendToClarityApi = async (rawChunk: string, defaultSpeaker: string = "Speaker 1") => {
    if (!rawChunk || !rawChunk.trim()) return;

    let activeSpeaker = defaultSpeaker;
    let textToSend = rawChunk.trim();

    const speakerMatch = rawChunk.match(/^(Speaker\s*\d+|Participant|You \(Typed\)):\s*(.*)/i);
    if (speakerMatch) {
      activeSpeaker = speakerMatch[1];
      textToSend = speakerMatch[2];
    }

    try {
      const response = await fetch(`${SERVER_API_URL}/api/clarity/enhance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawChunk: textToSend, speaker: activeSpeaker }),
      });
      const data = await response.json();
      if (data.success) {
        if (data.enhancedLine && data.enhancedLine.enhancedText) {
          setEnhancedLines((prev) => [...prev, data.enhancedLine]);
        }
        if (data.question) {
          setClarityQuestions((prev) => [data.question, ...prev]);
          if (data.question.confidence === "unresolved") {
            setUnresolvedActionItems((prev) => [
              { id: data.question.id, question: data.question.question, timestamp: data.question.timestamp },
              ...prev,
            ]);
          }
        }
      }
    } catch (e) {
      console.error("Clarity enhancement API error:", e);
    }
  };

  const handleAskTypedQuestion = async (questionText: string) => {
    setIsProcessingQuestion(true);
    try {
      const response = await fetch(`${SERVER_API_URL}/api/clarity/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: questionText, speaker: "You (Typed)" }),
      });
      const data = await response.json();
      if (data.success && data.question) {
        setClarityQuestions((prev) => [data.question, ...prev]);
        if (data.question.confidence === "unresolved") {
          setUnresolvedActionItems((prev) => [
            { id: data.question.id, question: data.question.question, timestamp: data.question.timestamp },
            ...prev,
          ]);
        }
        setStatusNotification({
          message: `Question processed: "${data.question.question.slice(0, 30)}..."`,
          type: "success",
        });
      }
    } catch (e: any) {
      console.error("Typed Q&A API error:", e);
      setStatusNotification({ message: `Q&A Error: ${e.message}`, type: "error" });
    } finally {
      setIsProcessingQuestion(false);
    }
  };

  const getFullTranscriptText = (): string => {
    const wsText = messageHistory
      .filter((m) => typeof m.data === "string" && m.data.trim())
      .map((m) => m.data.trim());

    const combined = [...localTranscripts, ...wsText];
    if (interimTranscript.trim()) {
      combined.push(interimTranscript.trim());
    }

    return combined.join(" ");
  };

  const handleSelectRecord = (record: MeetingRecord) => {
    setSelectedRecord(record);
    if (record.analysis) {
      setAnalysis(record.analysis);
      setActiveTab("ai");
      setStatusNotification({
        message: `Loaded Groq AI Insights for "${record.title}"`,
        type: "success",
      });
    } else {
      setStatusNotification({
        message: `No pre-saved Groq AI analysis found for "${record.title}".`,
        type: "info",
      });
      setActiveTab("ai");
    }
  };

  const handleAnalyzeWithGroq = async () => {
    const text = getFullTranscriptText();
    if (!text || text.trim().length === 0) {
      setStatusNotification({
        message: "No transcript recorded yet to analyze. Speak or record audio first!",
        type: "error",
      });
      return;
    }

    setIsAnalyzing(true);
    setStatusNotification({ message: "Analyzing transcript with Groq AI...", type: "info" });

    try {
      const response = await fetch(`${SERVER_API_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      });

      const data = await response.json();
      if (data.success && data.analysis) {
        setSelectedRecord(null);
        setAnalysis(data.analysis);
        setActiveTab("ai");
        setStatusNotification({ message: "Groq AI Analysis complete!", type: "success" });
      } else {
        throw new Error(data.error || "Failed to analyze transcript");
      }
    } catch (err: any) {
      console.error("Groq Analysis Error:", err);
      setStatusNotification({ message: `Groq Error: ${err.message}`, type: "error" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveToFirebase = async () => {
    const text = getFullTranscriptText();
    if (!text || text.trim().length === 0) {
      setStatusNotification({
        message: "Cannot save empty transcript to Firebase.",
        type: "error",
      });
      return;
    }

    setIsSaving(true);
    setStatusNotification({ message: "Saving to Firebase Database...", type: "info" });

    try {
      const response = await fetch(`${SERVER_API_URL}/api/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawTranscript: text,
          analysis: analysis,
          title: `Google Meet Notes - ${new Date().toLocaleTimeString()}`,
          source: "Chrome Extension - Meeting Shadow Agent",
        }),
      });

      const data = await response.json();
      if (data.success) {
        setStatusNotification({
          message: data.message || "Meeting saved successfully to Firebase! Starting fresh transcript...",
          type: "success",
        });

        // Reset current transcript and clarity state for a fresh new meeting transcript session
        setLocalTranscripts([]);
        setInterimTranscript("");
        setEnhancedLines([]);
        setClarityQuestions([]);
        setUnresolvedActionItems([]);
        setAnalysis(null);
        setSelectedRecord(null);
        clarityProcessedCountRef.current = 0;

        if (typeof chrome !== "undefined" && chrome?.storage?.local) {
          chrome.storage.local.set({ savedTranscripts: [] });
        } else {
          localStorage.removeItem("savedTranscripts");
        }

        // Reset server-side clarity memory
        try {
          await fetch(`${SERVER_API_URL}/api/clarity/reset`, { method: "POST" });
        } catch (_e) { /* ignore reset error */ }

        fetchSavedHistory();
      } else {
        throw new Error(data.error || "Save failed");
      }
    } catch (err: any) {
      console.error("Firebase Save Error:", err);
      setStatusNotification({ message: `Firebase Save Error: ${err.message}`, type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  const fetchSavedHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const response = await fetch(`${SERVER_API_URL}/api/meetings`);
      const data = await response.json();
      if (data.success && Array.isArray(data.meetings)) {
        setSavedMeetings(data.meetings);
      }
    } catch (err) {
      console.error("History fetch error:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  return (
    <div className="container">
      <header className="header">
        <div className="title-row">
          <h1>🎙️ Meeting Shadow Agent</h1>
          <span className={`status-badge ${connectionStatus.toLowerCase()}`}>
            {connectionStatus}
          </span>
        </div>
        <p className="subtitle">Real-time tab audio transcription, Groq AI task filtering & Firebase DB sync</p>
      </header>

      {/* Navigation Tabs */}
      <nav className="tab-nav">
        <button
          className={`tab-btn ${activeTab === "clarity" ? "active" : ""}`}
          onClick={() => setActiveTab("clarity")}
        >
          ✨ Live Clarity Layer {enhancedLines.length > 0 ? `(${enhancedLines.length})` : ""}
        </button>
        <button
          className={`tab-btn ${activeTab === "transcript" ? "active" : ""}`}
          onClick={() => setActiveTab("transcript")}
        >
          📝 Live Transcript ({localTranscripts.length + messageHistory.length})
        </button>
        <button
          className={`tab-btn ${activeTab === "ai" ? "active" : ""}`}
          onClick={() => setActiveTab("ai")}
        >
          🤖 Groq AI Insights {analysis ? "✓" : ""}
        </button>
        <button
          className={`tab-btn ${activeTab === "history" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("history");
            fetchSavedHistory();
          }}
        >
          💾 Firebase History
        </button>
      </nav>

      {/* Toast notification banner */}
      {statusNotification && (
        <div className={`notification-banner ${statusNotification.type}`}>
          <span>{statusNotification.message}</span>
          <button className="close-banner" onClick={() => setStatusNotification(null)}>×</button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="content-area">
        {/* Tab 0: Live Clarity Layer (Two-Pane View) */}
        {activeTab === "clarity" && (
          <LiveClarityView
            enhancedLines={enhancedLines}
            questions={clarityQuestions}
            unresolvedActionItems={unresolvedActionItems}
            onAskTypedQuestion={handleAskTypedQuestion}
            isProcessingQuestion={isProcessingQuestion}
          />
        )}
        {/* Tab 1: Live Transcript */}
        {activeTab === "transcript" && (
          <div className="transcription-area" ref={transcriptionAreaRef}>
            <div id="transcript" className="transcript" ref={transcriptRef}>
              {localTranscripts.length === 0 &&
                messageHistory.filter((m) => typeof m.data === "string" && m.data.trim()).length === 0 &&
                !interimTranscript ? (
                <p className="placeholder-text">
                  {isCapturing
                    ? "🔴 Listening... Speak now and raw text will appear here in real time."
                    : "Click 'Start Recording' and start speaking to record raw transcript."}
                </p>
              ) : (
                <>
                  {/* Local & WebSocket speech transcripts */}
                  {localTranscripts.map((text, index) => (
                    <p key={`transcript-${index}`}>{text}</p>
                  ))}

                  {/* Real-time interim transcript (being spoken right now) */}
                  {interimTranscript && (
                    <p key="interim" className="interim-text" style={{ fontStyle: "italic", opacity: 0.8, color: "#6366f1" }}>
                      🎙️ {interimTranscript}...
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Groq AI Insights */}
        {activeTab === "ai" && (
          <div className="ai-insights-area">
            {selectedRecord && (
              <div className="selected-record-banner">
                <span>📁 Saved Database Record: <strong>{selectedRecord.title}</strong></span>
                <span className="selected-record-time">{new Date(selectedRecord.timestamp).toLocaleString()}</span>
              </div>
            )}

            {!analysis ? (
              <div className="ai-empty-state">
                <p>No AI Analysis generated yet.</p>
                <button
                  className="action-btn analyze-btn"
                  onClick={handleAnalyzeWithGroq}
                  disabled={isAnalyzing}
                >
                  {isAnalyzing ? "Analyzing with Groq..." : "⚡ Run Groq AI Analysis Now"}
                </button>
              </div>
            ) : (
              <div className="analysis-cards">
                {/* Summary Card */}
                <div className="insight-card summary-card">
                  <h3>🧠 Executive Summary (Understand Content in One Go)</h3>
                  <p>{analysis.summary}</p>

                  {analysis.keyInsights && analysis.keyInsights.length > 0 && (
                    <div className="key-insights">
                      <h4>Key Discussion Points:</h4>
                      <ul>
                        {analysis.keyInsights.map((pt, i) => (
                          <li key={i}>{pt}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Tasks & Deadlines Grid */}
                <div className="grid-cards">
                  {/* Tasks Card */}
                  <div className="insight-card tasks-card">
                    <h3>☑️ Extracted Tasks & Action Items</h3>
                    {analysis.tasks && analysis.tasks.length > 0 ? (
                      <ul className="task-list">
                        {analysis.tasks.map((t, i) => (
                          <li key={i} className="task-item">
                            <span className="task-text">{t.task}</span>
                            <div className="task-meta">
                              {t.assignee && <span className="assignee-badge">👤 {t.assignee}</span>}
                              {t.priority && (
                                <span className={`priority-badge ${t.priority.toLowerCase()}`}>
                                  {t.priority}
                                </span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="empty-subtext">No specific action items identified yet.</p>
                    )}
                  </div>

                  {/* Deadlines Card */}
                  <div className="insight-card deadlines-card">
                    <h3>⏰ Deadlines & Target Dates</h3>
                    {analysis.deadlines && analysis.deadlines.length > 0 ? (
                      <ul className="deadline-list">
                        {analysis.deadlines.map((d, i) => (
                          <li key={i} className="deadline-item">
                            <span className="deadline-item-name">📌 {d.item}</span>
                            <span className="deadline-date">⏳ {d.dueDate}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="empty-subtext">No specific deadlines detected in meeting.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Firebase Saved Meetings History */}
        {activeTab === "history" && (
          <div className="history-area">
            <div className="history-header">
              <h3>Database Records ({savedMeetings.length})</h3>
              <button className="refresh-btn" onClick={fetchSavedHistory} disabled={isLoadingHistory}>
                {isLoadingHistory ? "Refreshing..." : "🔄 Refresh"}
              </button>
            </div>

            {savedMeetings.length === 0 ? (
              <p className="placeholder-text">No meetings saved to database yet. Use "Save to Firebase" to store records.</p>
            ) : (
              <div className="history-list">
                {savedMeetings.map((m) => (
                  <div
                    key={m.id}
                    className={`history-card ${selectedRecord?.id === m.id ? "selected" : ""}`}
                    onClick={() => handleSelectRecord(m)}
                  >
                    <div className="history-card-header">
                      <h4>{m.title}</h4>
                      <span className="history-time">{new Date(m.timestamp).toLocaleString()}</span>
                    </div>
                    <p className="history-summary">
                      <strong>Summary:</strong> {m.analysis?.summary || m.rawTranscript.slice(0, 120) + "..."}
                    </p>
                    <div className="history-card-footer">
                      {m.analysis?.tasks && m.analysis.tasks.length > 0 ? (
                        <div className="history-badge-row">
                          <span className="count-badge">Task count: {m.analysis.tasks.length}</span>
                          {m.analysis.deadlines?.length ? (
                            <span className="count-badge deadline-badge">Deadlines: {m.analysis.deadlines.length}</span>
                          ) : null}
                        </div>
                      ) : (
                        <div />
                      )}
                      <span className="view-insights-hint">View Groq Insights →</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer / Control Bar */}
      <footer className="controls">
        <div className="button-group">
          <button
            className="control-btn start-btn"
            onClick={handleCaptureToggle}
            disabled={isCapturing}
          >
            ▶ Start Recording
          </button>
          <button
            className="control-btn stop-btn"
            onClick={stopCapture}
            disabled={!isCapturing}
          >
            ⏹ Stop
          </button>
          <button
            className="control-btn analyze-btn"
            onClick={handleAnalyzeWithGroq}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? "Analyzing..." : "⚡ Analyze (Groq AI)"}
          </button>
          <button
            className="control-btn save-btn"
            onClick={handleSaveToFirebase}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "💾 Save to Firebase"}
          </button>
        </div>

        <div className="auto-scroll">
          <input
            type="checkbox"
            id="autoscroll-chk"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          <label htmlFor="autoscroll-chk">Auto-scroll</label>
        </div>
      </footer>
    </div>
  );
}

export default App;
