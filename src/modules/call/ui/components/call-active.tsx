"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  Volume2Icon,
  VolumeXIcon,
  LoaderIcon,
  MessageSquareIcon,
  BotIcon,
  UserIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

// ─── Call Active Component ───────────────────────────────────────────────────

interface Props {
  onLeave: () => void;
  meetingId: string;
  meetingName: string;
}

export const CallActive = ({ onLeave, meetingId, meetingName }: Props) => {
  // State
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentName, setAgentName] = useState("AI Assistant");
  const [hasGreeted, setHasGreeted] = useState(false);
  const [ttsMuted, setTtsMuted] = useState(false);

  // Refs
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const conversationHistoryRef = useRef<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isListeningRef = useRef(false);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── TTS (Text-to-Speech) ──────────────────────────────────────────────────

  const speak = useCallback(
    (text: string) => {
      if (ttsMuted) {
        setIsSpeaking(false);
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      // Try to pick a good voice
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) =>
          v.name.includes("Google") ||
          v.name.includes("Samantha") ||
          v.name.includes("Microsoft")
      );
      if (preferred) utterance.voice = preferred;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        // Auto-resume listening after agent finishes speaking
        if (isListeningRef.current) {
          startRecognition();
        }
      };
      utterance.onerror = () => setIsSpeaking(false);

      synthRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [ttsMuted]
  );

  // ─── Groq API call ────────────────────────────────────────────────────────

  const sendToGroq = useCallback(
    async (userMessage: string) => {
      setIsProcessing(true);

      try {
        const res = await fetch("/api/chat/groq", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meetingId,
            userMessage,
            conversationHistory: conversationHistoryRef.current.slice(-10),
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to get AI response");
        }

        const data = await res.json();
        const aiResponse: string = data.response;
        const name: string = data.agentName;

        if (name) setAgentName(name);

        // Update conversation
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: aiResponse,
        };
        conversationHistoryRef.current.push(assistantMsg);
        setMessages((prev) => [...prev, assistantMsg]);

        // Speak the response
        speak(aiResponse);
      } catch (error) {
        console.error("[CallActive] Groq error:", error);
        const errorMsg: ChatMessage = {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
        };
        setMessages((prev) => [...prev, errorMsg]);
        speak(errorMsg.content);
      } finally {
        setIsProcessing(false);
      }
    },
    [meetingId, speak]
  );

  // ─── Speech Recognition ───────────────────────────────────────────────────

  const startRecognition = useCallback(() => {
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      console.warn("SpeechRecognition not supported");
      return;
    }

    // Don't start if agent is speaking or processing
    if (isSpeaking || isProcessing) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      setCurrentTranscript(interimTranscript || finalTranscript);

      if (finalTranscript.trim()) {
        const userMsg: ChatMessage = {
          role: "user",
          content: finalTranscript.trim(),
        };
        conversationHistoryRef.current.push(userMsg);
        setMessages((prev) => [...prev, userMsg]);
        setCurrentTranscript("");
        sendToGroq(finalTranscript.trim());
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.error("[SpeechRecognition] error:", event.error);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      // Auto-restart if still active and not speaking/processing
      if (isListeningRef.current && !isSpeaking && !isProcessing) {
        setTimeout(() => {
          if (isListeningRef.current) startRecognition();
        }, 300);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isSpeaking, isProcessing, sendToGroq]);

  // ─── Toggle microphone ───────────────────────────────────────────────────

  const toggleMic = useCallback(() => {
    if (isMuted) {
      // Unmute – start listening
      setIsMuted(false);
      isListeningRef.current = true;
      startRecognition();
    } else {
      // Mute – stop listening
      setIsMuted(true);
      isListeningRef.current = false;
      recognitionRef.current?.abort();
      setIsListening(false);
      setCurrentTranscript("");
    }
  }, [isMuted, startRecognition]);

  // ─── Greeting on mount ────────────────────────────────────────────────────

  useEffect(() => {
    if (hasGreeted) return;
    setHasGreeted(true);

    // Small delay to let component mount, then greet
    const timer = setTimeout(() => {
      sendToGroq(
        "Hello! I just joined the meeting. Please greet me and briefly introduce yourself."
      );
      // Start listening after greeting
      isListeningRef.current = true;
    }, 800);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Cleanup on leave ─────────────────────────────────────────────────────

  const handleLeave = useCallback(() => {
    isListeningRef.current = false;
    recognitionRef.current?.abort();
    window.speechSynthesis.cancel();
    setIsListening(false);
    setIsSpeaking(false);
    onLeave();
  }, [onLeave]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full text-white relative">
      {/* Header */}
      <div className="bg-[#101213] rounded-full p-4 flex items-center gap-4 m-4 mb-0">
        <Link
          href="/"
          className="flex items-center justify-center p-1 bg-white/10 rounded-full w-fit"
        >
          <Image src="/logo.svg" width={22} height={22} alt="Logo" />
        </Link>
        <h4 className="text-base flex-1">{meetingName}</h4>
        <div className="flex items-center gap-2">
          {isProcessing && (
            <div className="flex items-center gap-1.5 text-xs text-blue-400">
              <LoaderIcon className="size-3 animate-spin" />
              <span>Thinking…</span>
            </div>
          )}
          {isSpeaking && (
            <div className="flex items-center gap-1.5 text-xs text-green-400">
              <Volume2Icon className="size-3" />
              <span>{agentName} speaking…</span>
            </div>
          )}
          {isListening && !isSpeaking && !isProcessing && (
            <div className="flex items-center gap-1.5 text-xs text-amber-400">
              <MicIcon className="size-3" />
              <span>Listening…</span>
            </div>
          )}
        </div>
      </div>

      {/* Main content area: Agent visual + Transcript */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6 overflow-hidden">
        {/* Agent avatar / visualizer */}
        <div className="flex flex-col items-center gap-4">
          <div
            className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${
              isSpeaking
                ? "bg-gradient-to-br from-green-500/30 to-emerald-600/30 shadow-[0_0_60px_rgba(16,185,129,0.4)]"
                : isListening
                ? "bg-gradient-to-br from-amber-500/30 to-orange-600/30 shadow-[0_0_40px_rgba(245,158,11,0.3)]"
                : isProcessing
                ? "bg-gradient-to-br from-blue-500/30 to-indigo-600/30 shadow-[0_0_40px_rgba(99,102,241,0.3)]"
                : "bg-gradient-to-br from-slate-600/30 to-slate-700/30"
            }`}
          >
            {/* Pulse ring animation */}
            {(isSpeaking || isListening) && (
              <div
                className={`absolute inset-0 rounded-full animate-ping opacity-20 ${
                  isSpeaking ? "bg-green-500" : "bg-amber-500"
                }`}
                style={{ animationDuration: "2s" }}
              />
            )}
            <BotIcon
              className={`size-16 transition-colors duration-300 ${
                isSpeaking
                  ? "text-green-400"
                  : isListening
                  ? "text-amber-400"
                  : isProcessing
                  ? "text-blue-400"
                  : "text-slate-400"
              }`}
            />
          </div>
          <p className="text-lg font-medium text-white/90">{agentName}</p>
        </div>

        {/* Live transcript / interim text */}
        {currentTranscript && (
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl px-6 py-3 max-w-lg text-center">
            <p className="text-sm text-white/60 italic">{currentTranscript}</p>
          </div>
        )}
      </div>

      {/* Chat transcript panel */}
      <div className="mx-4 mb-2">
        <button
          onClick={() => setShowTranscript(!showTranscript)}
          className="flex items-center gap-2 text-xs text-white/50 hover:text-white/80 transition-colors mb-1 px-2"
        >
          <MessageSquareIcon className="size-3" />
          <span>Conversation ({messages.length})</span>
          {showTranscript ? (
            <ChevronDownIcon className="size-3" />
          ) : (
            <ChevronUpIcon className="size-3" />
          )}
        </button>

        {showTranscript && messages.length > 0 && (
          <div className="bg-[#101213]/80 backdrop-blur-sm rounded-2xl p-3 max-h-48 overflow-y-auto scrollbar-thin">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-2 mb-2 last:mb-0 ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {msg.role === "assistant" && (
                  <BotIcon className="size-4 text-green-400 mt-1 shrink-0" />
                )}
                <div
                  className={`rounded-xl px-3 py-2 max-w-[80%] text-sm ${
                    msg.role === "user"
                      ? "bg-blue-600/30 text-blue-100"
                      : "bg-white/5 text-white/80"
                  }`}
                >
                  {msg.content}
                </div>
                {msg.role === "user" && (
                  <UserIcon className="size-4 text-blue-400 mt-1 shrink-0" />
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="bg-[#101213] rounded-full px-6 py-3 mx-4 mb-4 flex items-center justify-center gap-4">
        {/* Mic toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleMic}
          className={`rounded-full w-12 h-12 ${
            isMuted
              ? "bg-red-500/20 hover:bg-red-500/30 text-red-400"
              : isListening
              ? "bg-green-500/20 hover:bg-green-500/30 text-green-400"
              : "bg-white/10 hover:bg-white/20 text-white"
          }`}
        >
          {isMuted ? (
            <MicOffIcon className="size-5" />
          ) : (
            <MicIcon className="size-5" />
          )}
        </Button>

        {/* TTS mute toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setTtsMuted(!ttsMuted);
            if (!ttsMuted) {
              window.speechSynthesis.cancel();
              setIsSpeaking(false);
            }
          }}
          className={`rounded-full w-12 h-12 ${
            ttsMuted
              ? "bg-red-500/20 hover:bg-red-500/30 text-red-400"
              : "bg-white/10 hover:bg-white/20 text-white"
          }`}
        >
          {ttsMuted ? (
            <VolumeXIcon className="size-5" />
          ) : (
            <Volume2Icon className="size-5" />
          )}
        </Button>

        {/* End call */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleLeave}
          className="rounded-full w-12 h-12 bg-red-600 hover:bg-red-700 text-white"
        >
          <PhoneOffIcon className="size-5" />
        </Button>
      </div>
    </div>
  );
};
