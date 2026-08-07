import groqService from "./groqService";
import firebaseService, { MeetingRecord } from "./firebaseService";
import Groq from "groq-sdk";
import config from "../config/config";

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

export interface ConnectedDocItem {
  id: string;
  title: string;
  source: string;
  content: string;
}

class ClarityService {
  private inMeetingMemory: EnhancedLine[] = [];
  private questionHistory: QuestionItem[] = [];
  private unresolvedActionItems: { id: string; question: string; timestamp: string }[] = [];
  private groqClient: Groq | null = null;

  // Connected Docs / Task Boards Mock Repository (Notion / Linear / Asana integration data)
  private connectedDocs: ConnectedDocItem[] = [
    {
      id: "doc_1",
      title: "Q3 Project Roadmap & Deliverables",
      source: "Notion - Project Hub",
      content: "Eureka event budget is capped at 50 rupees. Final submission for Eureka task is strictly August 30th.",
    },
    {
      id: "doc_2",
      title: "Team Worksheets & Assignments",
      source: "Linear Task Board",
      content: "Maths, Science, and Social Studies require 100 completed worksheets each before college freshers meeting.",
    },
    {
      id: "doc_3",
      title: "Ashwin's Work Allocations",
      source: "Asana Workspace",
      content: "Ashwin is responsible for completing Excel tasks by year end '26 and organizing Eureka event with budget of 50 rupees.",
    },
  ];

  constructor() {
    this.initGroq();
  }

  private initGroq() {
    if (config.GROQ_API_KEY && config.GROQ_API_KEY !== "YOUR_GROQ_API_KEY_HERE") {
      try {
        this.groqClient = new Groq({ apiKey: config.GROQ_API_KEY });
      } catch (e) {
        console.error("ClarityService Groq init error:", e);
      }
    }
  }

  /**
   * 1. LIVE TRANSCRIPT ENHANCEMENT
   * Processes small rolling windows (~5-10s) of raw speech.
   * Removes filler words (um, uh, like, you know), fixes grammar, keeps intent, names, numbers.
   */
  async enhanceTranscriptChunk(
    rawText: string,
    speaker: string = "Speaker 1"
  ): Promise<{ enhancedLine: EnhancedLine; question: QuestionItem | null }> {
    if (!rawText || !rawText.trim()) {
      const emptyLine: EnhancedLine = {
        id: `line_${Date.now()}`,
        speaker,
        rawText: "",
        enhancedText: "",
        timestamp: new Date().toLocaleTimeString(),
      };
      return { enhancedLine: emptyLine, question: null };
    }

    let activeSpeaker = speaker;
    let textToProcess = rawText.trim();

    const speakerMatch = rawText.match(/^(Speaker\s*\d+|Participant|You \(Typed\)):\s*(.*)/i);
    if (speakerMatch) {
      activeSpeaker = speakerMatch[1];
      textToProcess = speakerMatch[2];
    }

    let cleanedText = textToProcess;

    if (!this.groqClient && config.GROQ_API_KEY && config.GROQ_API_KEY !== "YOUR_GROQ_API_KEY_HERE") {
      this.initGroq();
    }

    if (this.groqClient) {
      try {
        const prompt = `You are a real-time speech enhancement AI for live meeting transcripts.
Task: Clean up the raw transcript snippet while maintaining 100% accurate meaning.
Rules:
1. Remove filler words (um, uh, like, you know, sort of, basically, I mean) and false starts.
2. Fix broken grammar into a complete, clear, display-ready sentence.
3. PRESERVE original meaning, speaker intent, technical terms, names, dates, and numbers EXACTLY.
4. Do NOT hallucinate or add any details not stated in input.
5. Return ONLY the cleaned text string (no quotes, no markdown wrappers).

Raw Snippet: "${rawText}"`;

        const response = await this.groqClient.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: "llama-3.3-70b-versatile",
          temperature: 0.2,
          max_tokens: 150,
        });

        const output = response.choices[0]?.message?.content?.trim();
        if (output) {
          cleanedText = output.replace(/^["']|["']$/g, "");
        }
      } catch (err) {
        console.error("Groq enhancement API error, falling back to rule-based cleaner:", err);
        cleanedText = this.fallbackCleanText(rawText);
      }
    } else {
      cleanedText = this.fallbackCleanText(rawText);
    }

    const enhancedLine: EnhancedLine = {
      id: `line_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      speaker: activeSpeaker,
      rawText: textToProcess,
      enhancedText: cleanedText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };

    // Store in short-term memory buffer (keeps last ~100 items / ~15-20 mins)
    this.inMeetingMemory.push(enhancedLine);
    if (this.inMeetingMemory.length > 100) {
      this.inMeetingMemory.shift();
    }

    // 2. LIVE QUESTION DETECTION
    const detectedQuestion = await this.detectAndAnswerQuestion(cleanedText, false, speaker);

    return { enhancedLine, question: detectedQuestion };
  }

  /**
   * Rule-based text cleaner fallback when Groq API key is missing or rate limited.
   */
  private fallbackCleanText(text: string): string {
    let clean = text
      .replace(/\b(um+|uh+|like|you know|sort of|basically|i mean|err+)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (clean.length > 0) {
      clean = clean.charAt(0).toUpperCase() + clean.slice(1);
      if (!/[.!?]$/.test(clean)) {
        clean += ".";
      }
    }
    return clean || text;
  }

  /**
   * 2. LIVE QUESTION DETECTION & INSTANT ANSWER SURFACING
   * Checks text or explicit typed input for questions and searches priority memory pipelines + Groq LLM.
   */
  async detectAndAnswerQuestion(
    text: string,
    isTyped: boolean = false,
    askedBy: string = "Participant"
  ): Promise<QuestionItem | null> {
    const isQuestion =
      isTyped ||
      /\?$/.test(text.trim()) ||
      /^(what|when|where|who|why|how|can we|did we|is there|are we|whose|which|could you|what's|do we)\b/i.test(text.trim());

    if (!isQuestion && !isTyped) {
      return null;
    }

    const questionText = text.trim();
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Step-by-step priority search pipeline:
    // Priority 1: In-Meeting Short Term Memory Buffer (excluding self)
    const inMeetingMatch = this.searchInMeetingMemory(questionText);

    // Priority 2: Past Meetings Store (Firebase / Memory store)
    const pastMeetingMatch = await this.searchPastMeetings(questionText);

    // Priority 3: Connected Docs / Task Boards (Notion/Linear/Asana)
    const connectedDocMatch = this.searchConnectedDocs(questionText);

    const bestMatch = inMeetingMatch || pastMeetingMatch || connectedDocMatch;

    // Gather context snippet for LLM
    const contextSnippet = bestMatch
      ? `Matched Source (${bestMatch.citation}): ${bestMatch.answer}`
      : this.inMeetingMemory
          .filter((l) => l.enhancedText.trim().toLowerCase() !== questionText.toLowerCase())
          .slice(-5)
          .map((l) => `${l.speaker}: ${l.enhancedText}`)
          .join("\n");

    // Ask Groq LLM for direct, concise answer
    const llmAnswer = await this.askGroqForAnswer(questionText, contextSnippet);

    if (llmAnswer && llmAnswer.toLowerCase() !== questionText.toLowerCase()) {
      const confidence: QuestionConfidence = bestMatch ? bestMatch.confidence : "answered";
      const citation = bestMatch ? bestMatch.citation : "Answered by Groq AI";
      const sourceType = inMeetingMatch ? "in_meeting" : pastMeetingMatch ? "past_meeting" : connectedDocMatch ? "connected_docs" : "in_meeting";

      const item: QuestionItem = {
        id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        question: questionText,
        askedBy,
        isTyped,
        timestamp,
        answer: llmAnswer,
        confidence,
        citation,
        sourceType,
      };
      this.questionHistory.unshift(item);
      return item;
    }

    if (bestMatch && bestMatch.answer.trim().toLowerCase() !== questionText.toLowerCase()) {
      const sourceType = inMeetingMatch ? "in_meeting" : pastMeetingMatch ? "past_meeting" : "connected_docs";
      const item: QuestionItem = {
        id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        question: questionText,
        askedBy,
        isTyped,
        timestamp,
        answer: bestMatch.answer,
        confidence: bestMatch.confidence,
        citation: bestMatch.citation,
        sourceType,
      };
      this.questionHistory.unshift(item);
      return item;
    }

    // If no confident answer exists: flag as UNRESOLVED and auto-add to action items
    const unresolvedItem: QuestionItem = {
      id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      question: questionText,
      askedBy,
      isTyped,
      timestamp,
      answer: "Unanswered — needs follow-up",
      confidence: "unresolved",
      citation: "Added to Live Action Items",
      sourceType: "none",
    };

    this.unresolvedActionItems.unshift({
      id: `action_${Date.now()}`,
      question: questionText,
      timestamp,
    });

    this.questionHistory.unshift(unresolvedItem);
    return unresolvedItem;
  }

  /**
   * Query Groq LLM to generate direct 1-2 sentence answer to questions
   */
  private async askGroqForAnswer(
    questionText: string,
    contextInfo: string
  ): Promise<string | null> {
    if (!this.groqClient && config.GROQ_API_KEY && config.GROQ_API_KEY !== "YOUR_GROQ_API_KEY_HERE") {
      this.initGroq();
    }
    if (!this.groqClient) return null;

    try {
      const prompt = `You are an intelligent real-time AI assistant for live meetings.
Task: Answer the user's question directly, accurately, and concisely in 1-2 clear sentences.

Question: "${questionText}"

Context (Live transcript / Past notes / Docs):
${contextInfo || "No specific meeting context. Answer accurately using general knowledge."}

Rules:
1. Provide ONLY the direct answer.
2. Do NOT repeat the question.
3. Do NOT include introductory text like "Here is the answer:" or quote marks around the answer.
4. Keep the answer concise and clear.`;

      const response = await this.groqClient.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.2,
        max_tokens: 150,
      });

      const output = response.choices[0]?.message?.content?.trim();
      if (output) {
        return output.replace(/^["']|["']$/g, "");
      }
    } catch (err) {
      console.error("Groq question answer error:", err);
    }
    return null;
  }

  /**
   * Search Priority 1: In-Meeting Memory Buffer
   */
  private searchInMeetingMemory(question: string): { answer: string; confidence: QuestionConfidence; citation: string } | null {
    const qLower = question.toLowerCase().trim();
    const keywords = qLower.replace(/[^\w\s]/g, "").split(" ").filter(w => w.length > 3);

    for (let i = this.inMeetingMemory.length - 1; i >= 0; i--) {
      const line = this.inMeetingMemory[i];
      const lineLower = line.enhancedText.toLowerCase().trim();

      // Skip if line is identical or matches the question itself!
      if (lineLower === qLower || lineLower.replace(/[^\w\s]/g, "") === qLower.replace(/[^\w\s]/g, "")) {
        continue;
      }

      const matchCount = keywords.filter(kw => lineLower.includes(kw)).length;
      if (matchCount >= 2 || (keywords.length === 1 && matchCount === 1 && lineLower.length < 80)) {
        return {
          answer: line.enhancedText,
          confidence: matchCount >= 3 ? "answered" : "partially_answered",
          citation: `Said by ${line.speaker} at ${line.timestamp}`,
        };
      }
    }
    return null;
  }

  /**
   * Search Priority 2: Past Meetings Store
   */
  private async searchPastMeetings(question: string): Promise<{ answer: string; confidence: QuestionConfidence; citation: string } | null> {
    try {
      const meetings = await firebaseService.getMeetings();
      const qLower = question.toLowerCase();
      const keywords = qLower.replace(/[^\w\s]/g, "").split(" ").filter(w => w.length > 3);

      for (const m of meetings) {
        const textToSearch = `${m.title} ${m.analysis?.summary || ""} ${m.rawTranscript || ""}`.toLowerCase();
        const matchCount = keywords.filter(kw => textToSearch.includes(kw)).length;

        if (matchCount >= 2) {
          const matchedSummary = m.analysis?.summary || m.rawTranscript.slice(0, 140);
          return {
            answer: matchedSummary,
            confidence: matchCount >= 3 ? "answered" : "partially_answered",
            citation: `From past meeting: ${m.title}`,
          };
        }
      }
    } catch (e) {
      console.error("Error searching past meetings:", e);
    }
    return null;
  }

  /**
   * Search Priority 3: Connected Task Boards / Docs
   */
  private searchConnectedDocs(question: string): { answer: string; confidence: QuestionConfidence; citation: string } | null {
    const qLower = question.toLowerCase();
    const keywords = qLower.replace(/[^\w\s]/g, "").split(" ").filter(w => w.length > 3);

    for (const doc of this.connectedDocs) {
      const docLower = `${doc.title} ${doc.content}`.toLowerCase();
      const matchCount = keywords.filter(kw => docLower.includes(kw)).length;

      if (matchCount >= 2 || (keywords.length === 1 && matchCount === 1)) {
        return {
          answer: doc.content,
          confidence: "answered",
          citation: `From ${doc.source}: "${doc.title}"`,
        };
      }
    }
    return null;
  }

  public getState() {
    return {
      inMeetingMemory: this.inMeetingMemory,
      questionHistory: this.questionHistory,
      unresolvedActionItems: this.unresolvedActionItems,
      connectedDocsCount: this.connectedDocs.length,
    };
  }

  public resetState() {
    this.inMeetingMemory = [];
    this.questionHistory = [];
    this.unresolvedActionItems = [];
  }
}

export default new ClarityService();
