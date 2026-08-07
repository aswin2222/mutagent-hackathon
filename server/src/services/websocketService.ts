// websocketService.js
import WebSocket from "ws";
import constants from "../config/constants";

class WebSocketService {
  private wss: WebSocket.Server | null = null;
  private clients: Set<WebSocket> = new Set();
  private deepgramService: any | null = null;

  constructor() {
    this.reset();
    this.init();
  }

  init() {
    this.wss = new WebSocket.Server({ port: constants.WEBSOCKET_PORT });
    this.setupWebSocketEvents();
  }

  reset() {
    this.wss = null;
    this.clients.clear();
    this.deepgramService = null;
  }

  // Setter to inject DeepgramService instance
  setDeepgramService(deepgramService: any) {
    this.deepgramService = deepgramService;
  }

  setupWebSocketEvents() {
    this.wss!.on("connection", (ws) => {
      console.log("New WebSocket connection established");
      this.clients.add(ws);

      ws.on("message", (data) => this.handleMessage(data));
      ws.on("close", () => {
        console.log("WebSocket connection closed");
        this.clients.delete(ws);
      });
      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        this.clients.delete(ws);
      });
    });

    this.wss!.on("listening", () => {
      console.log(
        `WebSocket server is listening on port ${constants.WEBSOCKET_PORT}`
      );
    });

    this.wss!.on("error", (error) =>
      console.error("WebSocket server error:", error)
    );
  }

  handleMessage(data: any) {
    if (data instanceof Buffer) {
      console.log("Received audio chunk of size:", data.length);
      if (this.deepgramService) {
        this.deepgramService.sendAudioChunk(data);
      } else {
        console.log("Deepgram service not initialized");
      }
    } else {
      console.log("Received non-binary message:", data.toString());
    }
  }

  sendTranscript(transcript: any) {
    if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
      return;
    }

    if (this.clients.size === 0) {
      console.error("No active WebSocket connection to send transcript");
      return;
    }

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(transcript);
      }
    });
  }
}

export default new WebSocketService();

