import { useEffect, useRef, useState } from 'react';

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const messageHandlers = useRef<Map<string, Set<(data: any) => void>>>(new Map());

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      setConnected(true);
    };

    ws.current.onclose = () => {
      setConnected(false);
      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        if (!ws.current || ws.current.readyState === WebSocket.CLOSED) {
          // Don't create infinite reconnection loops
          console.log('WebSocket disconnected, attempting to reconnect...');
        }
      }, 3000);
    };

    ws.current.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        const handlers = messageHandlers.current.get(message.type);
        if (handlers) {
          handlers.forEach(handler => handler(message));
        }
      } catch (error) {
        console.error('WebSocket message parsing error:', error);
      }
    };

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, []);

  const subscribe = (messageType: string, handler: (data: any) => void) => {
    if (!messageHandlers.current.has(messageType)) {
      messageHandlers.current.set(messageType, new Set());
    }
    messageHandlers.current.get(messageType)!.add(handler);

    return () => {
      messageHandlers.current.get(messageType)?.delete(handler);
    };
  };

  const send = (data: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(data));
    }
  };

  const subscribeToLogs = (botId: string) => {
    send({ type: 'subscribe_logs', botId });
  };

  const unsubscribeFromLogs = (botId: string) => {
    send({ type: 'unsubscribe_logs', botId });
  };

  return {
    connected,
    subscribe,
    send,
    subscribeToLogs,
    unsubscribeFromLogs
  };
}
