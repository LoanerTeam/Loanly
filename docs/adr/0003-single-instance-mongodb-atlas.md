# One server instance, MongoDB for persistence

Live connections are tracked in an in-memory map, so the server must run as exactly one instance (Render free plan). All durable state (users, rooms, messages, read markers) lives in MongoDB Atlas M0, so restarts lose only connections, not data. Scaling out later would need a pub/sub layer between instances.
