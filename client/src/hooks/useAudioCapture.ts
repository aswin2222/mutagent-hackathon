import { useRef } from "react";

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

function useAudioCapture(
  AudioCaptureInvervalMS: number,
  setIsCapturing: (isCapturing: boolean) => void,
  onDataAvailable: (audioBlob: Blob) => void,
  onLocalTranscript?: (transcript: string, isFinal: boolean) => void
) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef<boolean>(false);

  const startSpeechRecognition = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn("Browser SpeechRecognition API is not supported in this browser.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcriptPiece = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcriptPiece;
          } else {
            interimTranscript += transcriptPiece;
          }
        }

        if (finalTranscript.trim() && onLocalTranscript) {
          onLocalTranscript(finalTranscript.trim(), true);
        } else if (interimTranscript.trim() && onLocalTranscript) {
          onLocalTranscript(interimTranscript.trim(), false);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("Speech recognition error:", event.error);
      };

      recognition.onend = () => {
        // Auto-restart if capture is still active
        if (isListeningRef.current) {
          try {
            recognition.start();
          } catch (e) {
            console.error("Failed to restart speech recognition:", e);
          }
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.error("Error initializing Speech Recognition:", err);
    }
  };

  const stopSpeechRecognition = () => {
    isListeningRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error("Error stopping speech recognition:", e);
      }
      recognitionRef.current = null;
    }
  };

  const setupMediaRecorder = (stream: MediaStream) => {
    let mimeType = "audio/webm";
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
        mimeType = "audio/ogg;codecs=opus";
      } else {
        mimeType = "";
      }
    }

    const options = mimeType ? { mimeType } : undefined;
    const mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        onDataAvailable(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    };

    mediaRecorder.start(AudioCaptureInvervalMS);
  };

  const startCapture = async () => {
    isListeningRef.current = true;

    // Start native browser Speech Recognition for instant local microphone text (Speaker 2)
    startSpeechRecognition();

    if (typeof chrome !== "undefined" && chrome?.tabCapture?.capture) {
      chrome.tabCapture.capture({ audio: true, video: false }, (stream) => {
        if (chrome.runtime?.lastError || !stream) {
          console.error("Error capturing tab audio:", chrome.runtime?.lastError);
          return;
        }

        audioStreamRef.current = stream;

        try {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          const output = new AudioCtx();
          if (output.state === "suspended") {
            output.resume();
          }
          const source = output.createMediaStreamSource(stream);
          source.connect(output.destination);
        } catch (error) {
          console.error("Error creating audio context:", error);
        }

        setupMediaRecorder(stream);
        setIsCapturing(true);
      });
    } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStreamRef.current = stream;
        setupMediaRecorder(stream);
        setIsCapturing(true);
      } catch (error) {
        console.error("Error capturing audio from mediaDevices:", error);
      }
    } else {
      console.error("Audio capture is not supported in this environment");
    }
  };

  const stopCapture = () => {
    stopSpeechRecognition();

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsCapturing(false);
  };

  return { startCapture, stopCapture };
}

export default useAudioCapture;


