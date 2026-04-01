"use client";

import { useMemo } from "react";
import { useNetworkStatus } from "@/hooks/use-network-status";

export type ShareDbConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "stopped"
  | "closed";

interface UseShareDbConnectionStatusOptions {
  connectionState: ShareDbConnectionState;
  connectionReason: string | null;
  hasSeenConnected: boolean;
  serverUrl: string;
  socketReadyState?: number;
}

interface UseShareDbConnectionStatusResult {
  statusLabel: string;
  statusTitle: string;
  indicatorClass: string;
  effectiveReason: string | null;
  serverHost: string;
  socketStateLabel: string;
}

export function useShareDbConnectionStatus({
  connectionState,
  connectionReason,
  hasSeenConnected,
  serverUrl,
  socketReadyState,
}: UseShareDbConnectionStatusOptions): UseShareDbConnectionStatusResult {
  const { isOffline } = useNetworkStatus();

  const effectiveReason = isOffline
    ? "Internet connection is unavailable."
    : connectionReason;

  const isSocketOpen = socketReadyState === 1 || socketReadyState == null;
  const isConnected =
    !isOffline && connectionState === "connected" && isSocketOpen;
  const isConnecting =
    !isOffline &&
    (socketReadyState === 0 ||
      connectionState === "connecting" ||
      (!hasSeenConnected && !isConnected));

  const statusLabel = isOffline
    ? "Offline"
    : isConnected
      ? "Connected"
      : isConnecting
        ? hasSeenConnected
          ? "Reconnecting..."
          : "Connecting..."
        : "Connection lost";

  const statusTitle = effectiveReason
    ? `${statusLabel}: ${effectiveReason}`
    : statusLabel;

  const indicatorClass = isOffline
    ? "bg-red-500"
    : isConnected
      ? "bg-emerald-500"
      : isConnecting
        ? "bg-amber-500 animate-pulse"
        : "bg-red-500";

  const serverHost = useMemo(() => {
    try {
      return new URL(serverUrl).host;
    } catch {
      return serverUrl;
    }
  }, [serverUrl]);

  const socketStateLabel = (() => {
    switch (socketReadyState) {
      case 0:
        return "CONNECTING";
      case 1:
        return "OPEN";
      case 2:
        return "CLOSING";
      case 3:
        return "CLOSED";
      default:
        return "UNKNOWN";
    }
  })();

  return {
    statusLabel,
    statusTitle,
    indicatorClass,
    effectiveReason,
    serverHost,
    socketStateLabel,
  };
}
