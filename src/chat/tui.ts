/**
 * Chat TUI overlay — side-chat with model picker, streaming, and exit actions.
 * Full btw parity.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, visibleWidth, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { ChatEngine } from "./engine.js";
import { EXIT_ACTIONS, executeExitAction, type ExitResult } from "./actions.js";

export interface ChatTUICallbacks {
  onExit: (result: ExitResult | null) => void;
}

export interface ChatTUIOptions {
  initialMessage?: string | undefined;
  extraContext?: string | undefined;
  ctx: ExtensionContext;
}

/**
 * Open the chat TUI overlay.
 * Returns the exit result (or null for discard).
 */
export async function createChatTUI(
  options: ChatTUIOptions,
  callbacks: ChatTUICallbacks,
): Promise<void> {
  const { ctx, initialMessage } = options;
  if (!ctx.hasUI) return;

  const engine = new ChatEngine(ctx, options.extraContext);

  await ctx.ui.custom<void>(
    (_tui, theme, _kb, done) => {
      let inputBuffer = initialMessage ?? "";
      let scrollOffset = 0;
      let showExitMenu = false;
      let exitMenuIndex = 0;
      let abortController: AbortController | null = null;
      let streamingChunks = "";
      let cachedLines: string[] | undefined;

      // If initial message provided, send it immediately
      if (initialMessage) {
        inputBuffer = "";
        sendMessage(initialMessage);
      }

      function invalidate() {
        cachedLines = undefined;
      }

      async function sendMessage(text: string) {
        if (!text.trim()) return;
        abortController = new AbortController();
        streamingChunks = "";
        invalidate();
        _tui.requestRender();

        try {
          await engine.send(
            text,
            abortController.signal,
            (chunk) => {
              streamingChunks += chunk;
              invalidate();
              _tui.requestRender();
            },
          );
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            streamingChunks = `Error: ${(err as Error).message}`;
          }
        } finally {
          streamingChunks = "";
          abortController = null;
          invalidate();
          _tui.requestRender();
        }
      }

      function handleInput(data: string) {
        if (showExitMenu) {
          handleExitMenuInput(data);
          return;
        }

        // Streaming — Esc cancels
        if (engine.streaming) {
          if (matchesKey(data, Key.escape)) {
            abortController?.abort();
          }
          return;
        }

        // Escape → exit menu (or close if empty conversation)
        if (matchesKey(data, Key.escape)) {
          if (engine.getMessages().length === 0) {
            callbacks.onExit(null);
            done(undefined);
            return;
          }
          showExitMenu = true;
          exitMenuIndex = 0;
          invalidate();
          _tui.requestRender();
          return;
        }

        // Enter → send message
        if (matchesKey(data, Key.enter)) {
          if (inputBuffer.trim()) {
            const msg = inputBuffer;
            inputBuffer = "";
            sendMessage(msg);
          }
          invalidate();
          _tui.requestRender();
          return;
        }

        // Ctrl+L → cycle model
        if (matchesKey(data, Key.ctrl("l"))) {
          const models = ctx.modelRegistry.getAll();
          if (models.length > 1) {
            const current = engine.model;
            const idx = current
              ? models.findIndex((m) => m.provider === current.provider && m.id === current.id)
              : -1;
            const next = models[(idx + 1) % models.length];
            if (next) {
              engine.setModel(next);
            }
          }
          invalidate();
          _tui.requestRender();
          return;
        }

        // Scroll
        if (matchesKey(data, Key.shift("up"))) {
          scrollOffset = Math.max(0, scrollOffset - 1);
          invalidate();
          _tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.shift("down"))) {
          scrollOffset++;
          invalidate();
          _tui.requestRender();
          return;
        }

        // Text input
        if (matchesKey(data, Key.backspace)) {
          inputBuffer = inputBuffer.slice(0, -1);
        } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
          inputBuffer += data;
        }

        invalidate();
        _tui.requestRender();
      }

      function handleExitMenuInput(data: string) {
        if (matchesKey(data, Key.escape)) {
          showExitMenu = false;
          invalidate();
          _tui.requestRender();
          return;
        }

        if (matchesKey(data, Key.up) || data === "k") {
          exitMenuIndex = Math.max(0, exitMenuIndex - 1);
        } else if (matchesKey(data, Key.down) || data === "j") {
          exitMenuIndex = Math.min(EXIT_ACTIONS.length - 1, exitMenuIndex + 1);
        } else if (matchesKey(data, Key.enter)) {
          const action = EXIT_ACTIONS[exitMenuIndex]!;
          executeExitAction(action.action, engine)
            .then((result) => {
              callbacks.onExit(result);
              done(undefined);
            })
            .catch(() => {
              callbacks.onExit(null);
              done(undefined);
            });
          return;
        } else {
          // Check shortcut keys
          for (const action of EXIT_ACTIONS) {
            if (data === action.key) {
              executeExitAction(action.action, engine)
                .then((result) => {
                  callbacks.onExit(result);
                  done(undefined);
                })
                .catch(() => {
                  callbacks.onExit(null);
                  done(undefined);
                });
              return;
            }
          }
        }

        invalidate();
        _tui.requestRender();
      }

      function render(width: number): string[] {
        if (cachedLines) return cachedLines;

        const innerW = width - 4;
        const lines: string[] = [];

        // Top border
        const modelName = engine.model ?? ctx.model?.id ?? "default";
        const titleText = ` 💬 Side Chat (${modelName}) `;
        const titleLen = visibleWidth(titleText);
        const leftDash = 1;
        const rightDash = Math.max(1, width - 2 - titleLen - leftDash);
        lines.push(
          theme.fg("accent", "╭" + "─".repeat(leftDash)) +
            theme.fg("accent", theme.bold(titleText)) +
            theme.fg("accent", "─".repeat(rightDash) + "╮"),
        );

        if (showExitMenu) {
          // Exit menu
          lines.push(padRow("", innerW, theme));
          lines.push(padRow(theme.bold("  Close side-chat:"), innerW, theme));
          lines.push(padRow("", innerW, theme));

          for (let i = 0; i < EXIT_ACTIONS.length; i++) {
            const action = EXIT_ACTIONS[i]!;
            const selected = i === exitMenuIndex;
            const cursor = selected ? theme.fg("accent", "▸") : " ";
            const key = theme.fg("dim", `[${action.key}]`);
            const label = selected ? theme.fg("accent", action.label) : action.label;
            const desc = theme.fg("dim", action.description);
            lines.push(padRow(`  ${cursor} ${key} ${label}  ${desc}`, innerW, theme));
          }

          lines.push(padRow("", innerW, theme));
          lines.push(padRow(theme.fg("dim", "  Enter select · Esc back"), innerW, theme));
        } else {
          // Chat messages
          const messages = engine.getMessages();
          const chatLines: string[] = [];

          for (const msg of messages) {
            const prefix = msg.role === "user"
              ? theme.fg("accent", "You: ")
              : theme.fg("success", "AI: ");
            const msgLines = wrapTextWithAnsi(msg.content, innerW - 4);
            chatLines.push("  " + prefix + (msgLines[0] ?? ""));
            for (let i = 1; i < msgLines.length; i++) {
              chatLines.push("      " + (msgLines[i] ?? ""));
            }
            chatLines.push("");
          }

          // Streaming indicator
          if (engine.streaming && streamingChunks) {
            const streamLines = wrapTextWithAnsi(streamingChunks, innerW - 4);
            chatLines.push("  " + theme.fg("success", "AI: ") + (streamLines[0] ?? ""));
            for (let i = 1; i < streamLines.length; i++) {
              chatLines.push("      " + (streamLines[i] ?? ""));
            }
            chatLines.push("  " + theme.fg("dim", "▌"));
          } else if (engine.streaming) {
            chatLines.push("  " + theme.fg("dim", "Thinking...▌"));
          }

          // Available height for chat
          const maxChatHeight = 15;
          const startIdx = Math.max(0, chatLines.length - maxChatHeight + scrollOffset);
          const visibleChat = chatLines.slice(startIdx, startIdx + maxChatHeight);

          if (visibleChat.length === 0) {
            lines.push(padRow(theme.fg("dim", "  Start typing to chat..."), innerW, theme));
          }
          for (const cl of visibleChat) {
            lines.push(padRow(cl, innerW, theme));
          }

          // Padding to fill space
          const remaining = maxChatHeight - visibleChat.length;
          for (let i = 0; i < Math.max(0, remaining); i++) {
            lines.push(padRow("", innerW, theme));
          }

          // Input separator
          lines.push(
            theme.fg("accent", "├") +
            theme.fg("dim", "─".repeat(width - 2)) +
            theme.fg("accent", "┤"),
          );

          // Input area
          const prompt = theme.fg("accent", "▸ ");
          const inputDisplay = inputBuffer + (engine.streaming ? "" : "█");
          lines.push(padRow(prompt + inputDisplay, innerW, theme));

          // Hints
          const hints = engine.streaming
            ? "Esc cancel"
            : "Enter send · Esc close · Shift+↑↓ scroll · Ctrl+L model";
          lines.push(padRow(theme.fg("dim", "  " + hints), innerW, theme));
        }

        // Bottom border
        lines.push(theme.fg("accent", "╰" + "─".repeat(width - 2) + "╯"));

        cachedLines = lines;
        return lines;
      }

      return { render, invalidate, handleInput };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center" as unknown as "center",
        width: "70%",
        minWidth: 50,
        maxHeight: "80%",
      },
    },
  );
}

function pad(s: string, len: number): string {
  const vis = visibleWidth(s);
  return s + " ".repeat(Math.max(0, len - vis));
}

function padRow(content: string, innerW: number, theme: Theme): string {
  const fitted = visibleWidth(content) > innerW
    ? truncateToWidth(content, innerW)
    : pad(content, innerW);
  return theme.fg("accent", "│") + " " + fitted + " " + theme.fg("accent", "│");
}
