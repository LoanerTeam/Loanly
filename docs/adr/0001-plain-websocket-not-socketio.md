# Plain WebSocket with our own JSON protocol, not Socket.IO

The course requires chat to be implemented with socket programming and graded on explaining it. Browsers cannot open raw TCP sockets, so we use WebSocket (RFC 6455, over TCP via an HTTP upgrade) and define our own `{type, ...}` message protocol. Socket.IO would hide reconnects, rooms and framing behind a library, leaving little of our own socket code to explain.
