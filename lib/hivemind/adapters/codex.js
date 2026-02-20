const fs = require("fs");
const path = require("path");

const HOME = process.env.HOME || process.env.USERPROFILE;
const CODEX_SESSIONS = path.join(HOME, ".codex", "sessions");

const MIN_MESSAGES = 4;
const MIN_CHARS = 1500;
const MAX_CHUNK_SIZE = 30_000;

function flattenText(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") return item.text || item.content || "";
        return "";
      })
      .join("\n")
      .trim();
  }
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text.trim();
    if (typeof value.content === "string") return value.content.trim();
    if (Array.isArray(value.content)) {
      return value.content
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") return item.text || "";
          return "";
        })
        .join("\n")
        .trim();
    }
  }
  return "";
}

function textFromBlocks(blocks, allowedTypes) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => !allowedTypes || allowedTypes.includes(block.type))
    .map((block) => block.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function pushMessage(messages, role, text) {
  const normalized = flattenText(text);
  if (!normalized) return;
  const last = messages[messages.length - 1];
  if (last && last.role === role && last.text === normalized) return;
  messages.push({ role, text: normalized });
}

function parseEventMessage(entry, messages) {
  const payload = entry.payload || {};
  const eventType = payload.type;

  if (eventType === "user_message") {
    pushMessage(
      messages,
      "user",
      flattenText(payload.message) ||
        flattenText(payload.text_elements) ||
        flattenText(payload.content)
    );
    return;
  }

  if (eventType === "agent_reasoning") {
    pushMessage(
      messages,
      "reasoning",
      flattenText(payload.text) ||
        flattenText(payload.content) ||
        flattenText(payload.summary)
    );
  }
}

function parseResponseItem(entry, messages) {
  const payload = entry.payload || {};

  if (payload.type === "message") {
    const messagePayload = payload.message && typeof payload.message === "object" ? payload.message : payload;
    const role = messagePayload.role || payload.role;
    const content = messagePayload.content || payload.content;
    if (role === "assistant") {
      pushMessage(messages, "assistant", textFromBlocks(content, ["output_text", "text"]));
      return;
    }
    if (role === "user") {
      pushMessage(messages, "user", textFromBlocks(content, ["input_text", "text"]));
    }
    return;
  }

  if (payload.type === "reasoning") {
    pushMessage(messages, "reasoning", flattenText(payload.summary) || flattenText(payload.text));
  }
}

module.exports = {
  name: "codex",

  async scan(state) {
    const processed = state.processed || {};
    const items = [];

    if (!fs.existsSync(CODEX_SESSIONS)) return items;

    // Walk year/month/day directories
    const years = fs.readdirSync(CODEX_SESSIONS).filter((d) => /^\d{4}$/.test(d));
    for (const year of years) {
      const yearPath = path.join(CODEX_SESSIONS, year);
      const months = fs.readdirSync(yearPath).filter((d) => /^\d{2}$/.test(d));
      for (const month of months) {
        const monthPath = path.join(yearPath, month);
        const days = fs.readdirSync(monthPath).filter((d) => /^\d{2}$/.test(d));
        for (const day of days) {
          const dayPath = path.join(monthPath, day);
          if (!fs.statSync(dayPath).isDirectory()) continue;
          const files = fs.readdirSync(dayPath).filter((f) => f.endsWith(".jsonl"));
          for (const file of files) {
            const filePath = path.join(dayPath, file);
            const stat = fs.statSync(filePath);
            const ref = `${year}/${month}/${day}/${file}`;

            if (processed[ref] && processed[ref] >= stat.mtimeMs) continue;

            items.push({ ref, path: filePath, mtime: stat.mtimeMs });
          }
        }
      }
    }

    return items.sort((a, b) => b.mtime - a.mtime);
  },

  async read(item) {
    const content = fs.readFileSync(item.path, "utf8");
    const lines = content.split("\n").filter(Boolean);

    const messages = [];
    let sessionId = null;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        if (entry.type === "session_meta") {
          sessionId = entry.payload?.id;
          continue;
        }

        if (entry.type === "event_msg") parseEventMessage(entry, messages);
        if (entry.type === "user_message") pushMessage(messages, "user", entry.payload?.content || entry.payload?.text);
        if (entry.type === "response_item") parseResponseItem(entry, messages);
        if (entry.type === "agent_reasoning") pushMessage(messages, "reasoning", entry.payload?.content || entry.payload?.text);
      } catch {}
    }

    if (messages.length < MIN_MESSAGES) return [];
    const totalChars = messages.reduce((s, m) => s + m.text.length, 0);
    if (totalChars < MIN_CHARS) return [];

    const conversationText = messages
      .map((m) => `[${m.role}]\n${m.text}`)
      .join("\n\n");

    const chunks = [];
    if (conversationText.length <= MAX_CHUNK_SIZE) {
      chunks.push({
        text: conversationText,
        metadata: {
          adapter: "codex",
          ref: item.ref,
          sessionId,
          timestamp: new Date(item.mtime).toISOString(),
        },
      });
    } else {
      let offset = 0;
      let chunkIndex = 0;
      while (offset < conversationText.length && chunkIndex < 10) {
        chunks.push({
          text: conversationText.slice(offset, offset + MAX_CHUNK_SIZE),
          metadata: {
            adapter: "codex",
            ref: `${item.ref}#chunk${chunkIndex}`,
            sessionId,
            timestamp: new Date(item.mtime).toISOString(),
          },
        });
        offset += MAX_CHUNK_SIZE;
        chunkIndex++;
      }
    }

    return chunks;
  },
};
