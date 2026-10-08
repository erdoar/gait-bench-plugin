#!/usr/bin/env node
// UserPromptSubmit hook: when the message names one of the trigger words, remind Claude to open the Gait Bench Studio
// panel before anything else. It only adds context; it never blocks a prompt, and it stays silent on any error.
import { readFileSync } from 'node:fs';

export const TRIGGER = /\b(cap|caps|captures?|captured|capturing|mo|mocap|mo-cap|motion[- ]capture|gait)\b/i;

export function contextFor(prompt) {
  const m = typeof prompt === 'string' ? prompt.match(TRIGGER) : null;
  if (!m) return null;
  return `Gait Bench: the message says "${m[0]}". If it is about capturing motion from a video (a walk, gait, mocap), ` +
    'open the Gait Bench Studio panel first, before any other step: follow "Open the studio first" in the gait-bench ' +
    'skill (gb.mjs studio, then publish or reopen the "Gait Bench Studio" artifact). If the word means something else ' +
    'here, ignore this note.';
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
    const ctx = contextFor(input.prompt);
    if (ctx) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx } }));
  } catch { /* never get in the way of the prompt */ }
  process.exit(0);
}
