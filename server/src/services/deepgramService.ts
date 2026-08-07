import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import config from "../config/config";
import constants from "../config/constants";
import websocketService from "./websocketService";

class DeepgramService {
  private deepgramClient: any;
  private connection: any;
  private keepAliveInterval: NodeJS.Timeout | null;
  private audioBuffer: Buffer[];
  private isConnecting: boolean;

  constructor() {
    this.deepgramClient = createClient(config.DEEPGRAM_API_KEY);
    this.connection = null;
    this.keepAliveInterval = null;
    this.audioBuffer = [];
    this.isConnecting = false;
    websocketService.setDeepgramService(this);
  }

  async initConnection() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      this.connection = this.deepgramClient.listen.live({
        smart_format: true,
        punctuate: true,
        diarize: true,
        interim_results: true,
        model: constants.DEEPGRAM_MODEL || "nova-2",
        language: constants.DEFAULT_LANGUAGE || "en-US",
      });

      this.connection.on(LiveTranscriptionEvents.Open, () => {
        console.log("Deepgram connection opened successfully.");
        this.isConnecting = false;
        this.startKeepAlive();

        // Flush any buffered audio chunks
        while (this.audioBuffer.length > 0) {
          const bufferedChunk = this.audioBuffer.shift();
          if (bufferedChunk && this.connection.isConnected()) {
            this.connection.send(bufferedChunk);
          }
        }
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        console.log("Deepgram connection closed.");
        this.isConnecting = false;
        this.stopKeepAlive();
      });

      this.connection.on(LiveTranscriptionEvents.Error, (error: any) => {
        console.error("Deepgram connection error:", error);
        this.isConnecting = false;
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        const isFinal = Boolean(data?.is_final);
        const alt = data?.channel?.alternatives?.[0];
        const transcript = alt?.transcript;
        if (transcript && typeof transcript === "string" && transcript.trim().length > 0) {
          let speakerPrefix = "Speaker 1: ";
          if (alt.words && alt.words.length > 0 && alt.words[0].speaker !== undefined) {
            const speakerNum = alt.words[0].speaker + 1;
            speakerPrefix = `Speaker ${speakerNum}: `;
          }
          const formattedTranscript = `${speakerPrefix}${transcript.trim()}`;
          console.log("Deepgram Live Transcript:", formattedTranscript, `(isFinal: ${isFinal})`);
          websocketService.sendTranscript(JSON.stringify({ text: formattedTranscript, isFinal }));
        }
      });

      this.connection.on(LiveTranscriptionEvents.Metadata, (data: any) => {
        console.log("Deepgram Metadata received:", data);
      });
    } catch (err) {
      console.error("Failed to initialize Deepgram live client:", err);
      this.isConnecting = false;
    }
  }

  startKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    this.keepAliveInterval = setInterval(() => {
      if (this.connection && typeof this.connection.keepAlive === "function") {
        this.connection.keepAlive();
      }
    }, 10000);
  }

  stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  sendAudioChunk(chunk: Buffer) {
    if (!this.connection) {
      this.audioBuffer.push(chunk);
      this.initConnection();
      return;
    }

    try {
      const isConnOpen = typeof this.connection.isConnected === "function"
        ? this.connection.isConnected()
        : true;

      if (isConnOpen) {
        this.connection.send(chunk);
      } else {
        this.audioBuffer.push(chunk);
        if (!this.isConnecting) {
          this.initConnection();
        }
      }
    } catch (err) {
      console.error("Error sending chunk to Deepgram:", err);
    }
  }
}

export default new DeepgramService();

