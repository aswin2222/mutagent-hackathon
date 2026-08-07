import React, { useState, useRef, useEffect } from "react";

export interface EnhancedLine {
  id: string;
  speaker: string;
  rawText: string;
  enhancedText: string;
  timestamp: string;
}

export type QuestionConfidence = "answered" | "partially_answered" | "unresolved";

export interface QuestionItem {
  id: string;
  question: string;
  askedBy: string;
  isTyped: boolean;
  timestamp: string;
  answer?: string;
  confidence: QuestionConfidence;
  citation?: string;
  sourceType?: "in_meeting" | "past_meeting" | "connected_docs" | "none";
}

export interface UnresolvedActionItem {
  id: string;
  question: string;
  timestamp: string;
}

interface LiveClarityViewProps {
  enhancedLines: EnhancedLine[];
  questions: QuestionItem[];
  unresolvedActionItems: UnresolvedActionItem[];
  onAskTypedQuestion: (question: string) => Promise<void>;
  isProcessingQuestion: boolean;
}

export const LiveClarityView: React.FC<LiveClarityViewProps> = ({
  enhancedLines,
  questions,
  unresolvedActionItems,
  onAskTypedQuestion,
  isProcessingQuestion,
}) => {
  const [typedInput, setTypedInput] = useState<string>("");
  const [showRawComparison, setShowRawComparison] = useState<boolean>(false);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll transcript container
  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
    }
  }, [enhancedLines]);

  const handleSubmitQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedInput.trim() || isProcessingQuestion) return;
    const q = typedInput.trim();
    setTypedInput("");
    await onAskTypedQuestion(q);
  };

  const getConfidenceBadge = (confidence: QuestionConfidence) => {
    switch (confidence) {
      case "answered":
        return <span className="confidence-badge answered">✓ Answered</span>;
      case "partially_answered":
        return <span className="confidence-badge partial">⚡ Partial Answer</span>;
      case "unresolved":
      default:
        return <span className="confidence-badge unresolved">❌ Unresolved (Action Item)</span>;
    }
  };

  return (
    <div className="clarity-two-pane-container">
      {/* LEFT PANE: LIVE TRANSCRIPT ENHANCEMENT */}
      <div className="pane left-pane">
        <div className="pane-header">
          <div className="pane-title-group">
            <h3>✨ Live Cleaned Transcript</h3>
            <span className="live-pill">● LIVE ENHANCEMENT</span>
          </div>
          <button
            className="toggle-raw-btn"
            onClick={() => setShowRawComparison(!showRawComparison)}
          >
            {showRawComparison ? "Hide Raw Speech" : "Show Raw Speech"}
          </button>
        </div>

        <div className="transcript-feed" ref={transcriptScrollRef}>
          {enhancedLines.length === 0 ? (
            <div className="empty-feed">
              <p>🎙️ Start speaking or recording audio...</p>
              <span className="sub-hint">
                Noisy filler words (um, uh, like) will be removed in real-time, grammar corrected, and intent preserved.
              </span>
            </div>
          ) : (
            enhancedLines.map((line) => (
              <div key={line.id} className="enhanced-card">
                <div className="enhanced-card-header">
                  <span className="speaker-name">👤 {line.speaker}</span>
                  <span className="line-time">{line.timestamp}</span>
                </div>
                <p className="enhanced-text">{line.enhancedText}</p>
                {showRawComparison && line.rawText !== line.enhancedText && (
                  <div className="raw-comparison">
                    <span className="raw-label">Raw STT:</span>
                    <span className="raw-text">"{line.rawText}"</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* RIGHT PANE: LIVE QUESTION DETECTION & INSTANT ANSWERS */}
      <div className="pane right-pane">
        <div className="pane-header">
          <h3>❓ Instant Q&A & Answer Surfacing</h3>
          <span className="count-pill">{questions.length} Questions</span>
        </div>

        {/* Typed Sidebar Question Input Box */}
        <form className="typed-question-box" onSubmit={handleSubmitQuestion}>
          <input
            type="text"
            placeholder="Type a question without interrupting the speaker..."
            value={typedInput}
            onChange={(e) => setTypedInput(e.target.value)}
            disabled={isProcessingQuestion}
          />
          <button type="submit" disabled={!typedInput.trim() || isProcessingQuestion}>
            {isProcessingQuestion ? "Searching..." : "Ask AI ↵"}
          </button>
        </form>

        <div className="qa-feed">
          {questions.length === 0 ? (
            <div className="empty-qa">
              <p>No questions detected yet in meeting.</p>
              <span className="sub-hint">
                Spoken questions ("What's the deadline?") and typed questions will automatically query earlier meeting notes & connected docs.
              </span>
            </div>
          ) : (
            questions.map((q) => (
              <div key={q.id} className={`question-card ${q.confidence}`}>
                <div className="question-card-header">
                  <span className="question-author">
                    {q.isTyped ? "⌨️ Typed by " : "🎙️ Spoken by "}
                    <strong>{q.askedBy}</strong>
                  </span>
                  {getConfidenceBadge(q.confidence)}
                </div>

                <h4 className="question-title">"{q.question}"</h4>

                {q.answer && (
                  <div className="answer-section">
                    <p className="answer-text">
                      <strong>Answer:</strong> {q.answer}
                    </p>
                    {q.citation && (
                      <div className="citation-pill">
                        <span>📌 {q.citation}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Unresolved Action Items Surface */}
        {unresolvedActionItems.length > 0 && (
          <div className="action-items-section">
            <h4>📋 Live Action Items (Unresolved Questions)</h4>
            <ul className="action-items-list">
              {unresolvedActionItems.map((item) => (
                <li key={item.id} className="action-item-row">
                  <span className="action-icon">📌</span>
                  <span className="action-text">{item.question}</span>
                  <span className="action-time">{item.timestamp}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
