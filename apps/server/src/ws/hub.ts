import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientEvent } from "../types.js";

export class EventHub {
  private wss?: WebSocketServer;
  private backlog: ClientEvent[] = [];

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "hello", createdAt: new Date().toISOString() }));
      for (const event of this.backlog.slice(-100)) {
        socket.send(JSON.stringify(event));
      }
    });
  }

  publish(event: Omit<ClientEvent, "createdAt">): ClientEvent {
    const full = { ...event, createdAt: new Date().toISOString() };
    this.backlog.push(full);
    this.backlog = this.backlog.slice(-250);
    const payload = JSON.stringify(full);
    this.wss?.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
    return full;
  }
}

export const eventHub = new EventHub();
