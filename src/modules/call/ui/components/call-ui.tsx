import { useState } from "react";
import { StreamTheme, useCall } from "@stream-io/video-react-sdk";
import { useMutation } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";

import { CallLobby } from "./call-lobby";
import { CallActive } from "./call-active";
import { CallEnded } from "./call-ended";

interface Props {
  meetingId: string;
  meetingName: string;
}

export const CallUI = ({ meetingId, meetingName }: Props) => {
  const trpc = useTRPC();
  const call = useCall();
  const [show, setShow] = useState<"lobby" | "call" | "ended">("lobby");

  const joinMutation = useMutation(trpc.meetings.join.mutationOptions());
  const completeMutation = useMutation(trpc.meetings.complete.mutationOptions());

  const handleJoin = async () => {
    if (!call) return;

    try {
      console.log(`[CallUI] Joining meeting: ${meetingId}`);
      await call.join();
      
      // Update meeting status to "active" in database
      await joinMutation.mutateAsync({ id: meetingId });
      
      setShow("call");
    } catch (error) {
      console.error("[CallUI] Error joining meeting:", error);
    }
  };

  const handleLeave = async () => {
    if (!call) return;

    try {
      console.log(`[CallUI] Ending meeting: ${meetingId}`);
      
      // Trigger Inngest processing and update status to "processing"
      await completeMutation.mutateAsync({ id: meetingId });
      
      await call.endCall();
      setShow("ended");
    } catch (error) {
      console.error("[CallUI] Error ending meeting:", error);
      // Still show ended state if something fails
      setShow("ended");
    }
  };

  return (
    <StreamTheme className="h-full">
      {show === "lobby" && <CallLobby onJoin={handleJoin} />}
      {show === "call" && (
        <CallActive
          onLeave={handleLeave}
          meetingId={meetingId}
          meetingName={meetingName}
        />
      )}
      {show === "ended" && <CallEnded />}
    </StreamTheme>
  );
};
