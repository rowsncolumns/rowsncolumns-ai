# Agents Notes

## Chat Runtime Topology

- There are two chat runtime paths in this project.
- `app/api/chat` (and `app/api/chat/resume`) is the Vercel-hosted Next.js API route.
- External chat is hosted separately (Railway) and exposed as `/chat`, `/chat/resume`, and `/chat/stop`.

## Why External Chat Exists

- Vercel has a request duration limit of `300s` for this route/runtime.
- Long-running agentic chats can exceed `300s`.
- To support long chats, production can route chat execution to the external Railway chat service.

## Routing Behavior

- Frontend URL selection is controlled by `NEXT_PUBLIC_CHAT_API_BASE_URL`.
- If set, the assistant uses the external chat host (`/chat`, `/chat/resume`, `/chat/stop`).
- If unset, the assistant falls back to local Next.js routes (`/api/chat`, `/api/chat/resume`, `/api/chat/stop`).
