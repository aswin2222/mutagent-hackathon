import { useCallback, useEffect, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

interface WebSocketConnectionProps {
  messageHistory: MessageEvent[];
  connectionStatus: string;
  sendAudioChunk: (audioBlob: Blob) => void;
}

function useWebSocketConnection(
  socketUrl: string,
  autoScroll: boolean,
  transcriptRef: React.RefObject<HTMLDivElement>,
  transcriptionAreaRef: React.RefObject<HTMLDivElement>
): WebSocketConnectionProps {
  const [messageHistory, setMessageHistory] = useState<MessageEvent[]>([]);
  const { sendMessage, lastMessage, readyState } = useWebSocket(socketUrl);

  const appendToMessageHistory = useCallback(
    (message: MessageEvent) => setMessageHistory((prev) => [...prev, message]),
    []
  );

  useEffect(() => {
    if (
      lastMessage !== null &&
      typeof lastMessage.data === "string" &&
      lastMessage.data.trim().length > 0
    ) {
      appendToMessageHistory(lastMessage);

      if (autoScroll && transcriptionAreaRef.current && transcriptRef.current) {
        // Use requestAnimationFrame to ensure scrolling after the DOM update
        requestAnimationFrame(() => {
          transcriptionAreaRef.current!.scrollTo({
            top: transcriptionAreaRef.current!.scrollHeight,
            behavior: "smooth",
          });
        });
      }
    }
  }, [
    lastMessage,
    autoScroll,
    transcriptRef,
    transcriptionAreaRef,
    appendToMessageHistory,
  ]);

  const connectionStatus = {
    [ReadyState.CONNECTING]: "Connecting",
    [ReadyState.OPEN]: "Open",
    [ReadyState.CLOSING]: "Closing",
    [ReadyState.CLOSED]: "Closed",
    [ReadyState.UNINSTANTIATED]: "Uninstantiated",
  }[readyState];

  const sendAudioChunk = (audioBlob: Blob) => {
    if (readyState === ReadyState.OPEN) {
      sendMessage(audioBlob);
    } else {
      console.error("WebSocket is not open. Cannot send audio chunk.");
    }
  };

  return { messageHistory, connectionStatus, sendAudioChunk };
}

export default useWebSocketConnection;
