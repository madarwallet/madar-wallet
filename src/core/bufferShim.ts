import { Buffer } from "buffer";

(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
