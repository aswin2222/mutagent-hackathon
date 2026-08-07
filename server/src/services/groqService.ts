import Groq from "groq-sdk";
import config from "../config/config";

export interface TaskItem {
  task: string;
  assignee?: string;
  priority?: string;
}

export interface DeadlineItem {
  item: string;
  dueDate: string;
}

export interface MeetingAnalysis {
  summary: string;
  keyInsights: string[];
  tasks: TaskItem[];
  deadlines: DeadlineItem[];
}

class GroqService {
  private groqClient: Groq | null = null;

  constructor() {
    this.initClient();
  }

  private initClient() {
    if (config.GROQ_API_KEY && config.GROQ_API_KEY !== "YOUR_GROQ_API_KEY_HERE") {
      try {
        this.groqClient = new Groq({ apiKey: config.GROQ_API_KEY });
      } catch (error) {
        console.error("Failed to initialize Groq SDK:", error);
      }
    }
  }

  async analyzeTranscript(transcriptText: string): Promise<MeetingAnalysis> {
    if (!transcriptText || !transcriptText.trim()) {
      return {
        summary: "No transcript content provided for analysis.",
        keyInsights: [],
        tasks: [],
        deadlines: []
      };
    }

    // Re-attempt init if key was provided after startup
    if (!this.groqClient && config.GROQ_API_KEY && config.GROQ_API_KEY !== "YOUR_GROQ_API_KEY_HERE") {
      this.initClient();
    }

    if (!this.groqClient) {
      console.warn("Groq API key not set or using placeholder. Returning mock analysis template.");
      return this.generateMockAnalysis(transcriptText);
    }

    try {
      const prompt = `Analyze the following Google Meet / audio transcript and extract actionable insights.
Return a valid JSON object with the following schema:
{
  "summary": "A clear, high-level overview of the meeting content",
  "keyInsights": ["Key point 1", "Key point 2"],
  "tasks": [
    { "task": "Description of action item", "assignee": "Name or Unassigned", "priority": "High | Medium | Low" }
  ],
  "deadlines": [
    { "item": "Task or commitment name", "dueDate": "Extracted date/time or TBD" }
  ]
}

TRANSCRIPT:
${transcriptText}`;

      const chatCompletion = await this.groqClient.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "You are an AI meeting assistant that converts raw meeting transcripts into clear summaries, extracted tasks, and deadlines. Always output clean JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        model: "llama-3.3-70b-versatile",
        response_format: { type: "json_object" }
      });

      const responseContent = chatCompletion.choices[0]?.message?.content || "";
      const parsed: MeetingAnalysis = JSON.parse(responseContent);

      return {
        summary: parsed.summary || "Summary generated successfully.",
        keyInsights: parsed.keyInsights || [],
        tasks: parsed.tasks || [],
        deadlines: parsed.deadlines || []
      };
    } catch (error) {
      console.error("Groq API analysis error:", error);
      return this.generateMockAnalysis(transcriptText);
    }
  }

  private generateMockAnalysis(rawText: string): MeetingAnalysis {
    const sentences = rawText.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    return {
      summary: `[Demo Analysis] Summarized ${sentences.length} sentence(s) from the meeting transcript. Provide your GROQ_API_KEY in server/.env for live LLM extraction.`,
      keyInsights: [
        "Live audio was successfully transcribed via Deepgram",
        "Meeting shadow agent is actively monitoring key decisions"
      ],
      tasks: [
        {
          task: "Configure GROQ_API_KEY in server/.env for live task filtering",
          assignee: "Developer",
          priority: "High"
        }
      ],
      deadlines: [
        {
          item: "Setup Firebase database credentials in server/.env",
          dueDate: "As soon as possible"
        }
      ]
    };
  }
}

export default new GroqService();
