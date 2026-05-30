from __future__ import annotations

import json
from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        # Maps (user_id, role_id) to a list of WebSockets
        self.active_connections: dict[tuple[int, int], list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: int, role_id: int):
        await websocket.accept()
        key = (user_id, role_id)
        if key not in self.active_connections:
            self.active_connections[key] = []
        self.active_connections[key].append(websocket)

    def disconnect(self, websocket: WebSocket, user_id: int, role_id: int):
        key = (user_id, role_id)
        if key in self.active_connections:
            try:
                self.active_connections[key].remove(websocket)
                if not self.active_connections[key]:
                    del self.active_connections[key]
            except ValueError:
                pass

    async def send_personal_message(self, message: dict, user_id: int, role_id: int):
        key = (user_id, role_id)
        if key in self.active_connections:
            # Create a copy of the list to iterate over, in case a connection drops
            connections = list(self.active_connections[key])
            for connection in connections:
                try:
                    await connection.send_text(json.dumps(message, default=str))
                except Exception:
                    # If sending fails, assume disconnected and remove
                    self.disconnect(connection, user_id, role_id)

manager = ConnectionManager()
