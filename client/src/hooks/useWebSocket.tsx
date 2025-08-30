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
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const initialReconnectDelay = 1000;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      try {
        ws.current = new WebSocket(wsUrl);

        ws.current.onopen = () => {
          setConnected(true);
          reconnectAttempts = 0; // Reset on successful connection
          console.log('WebSocket connected successfully');
        };

        ws.current.onclose = () => {
          setConnected(false);
          console.log('WebSocket disconnected');
          
          // Only attempt reconnection if we haven't exceeded max attempts
          if (reconnectAttempts < maxReconnectAttempts) {
            const delay = initialReconnectDelay * Math.pow(2, reconnectAttempts); // Exponential backoff
            reconnectAttempts++;
            
            console.log(`Attempting to reconnect... (${reconnectAttempts}/${maxReconnectAttempts}) in ${delay}ms`);
            reconnectTimer = setTimeout(() => {
              if (!ws.current || ws.current.readyState === WebSocket.CLOSED) {
                connect();
              }
            }, delay);
          } else {
            console.warn('Max WebSocket reconnection attempts reached');
          }
        };

        ws.current.onerror = (error) => {
          console.error('WebSocket error:', error);
        };
      } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        setConnected(false);
      }
    };

    connect();

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
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (ws.current) {
        ws.current.close();
      }
      setConnected(false);
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
