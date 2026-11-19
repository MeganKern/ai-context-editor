import { z } from "zod";
import { AGENT_EFFORTS, AGENT_MODELS, AGENT_PERMISSIONS } from "./agent.js";

const id = z.string().min(1);
const ok = z.object({ ok: z.literal(true) });
const text = z.string().min(1);
const stepKind = z.enum(["post", "reply", "agent"]);
const permission = z.enum(AGENT_PERMISSIONS);

/**
 * Where something goes when it may start a thread: an existing thread, or a new one in the
 * workspace (named after what goes in it) — made in the same transaction, so there's no half-done
 * step for the app to finish.
 */
const inThread = { thread_id: id.nullable(), workspace_id: id.optional() };
const needsAHome = <T extends { thread_id: string | null; workspace_id?: string }>(a: T) => a.thread_id !== null || a.workspace_id !== undefined;
const HOME = { message: "A new thread needs its workspace" };

/**
 * Every write the client can ask for. Each is one intent and runs as one transaction on the
 * server, recorded as one change set: there's no multi-step sequence for the client to finish.
 * What each one does, in words, is in shared/behaviour.ts.
 */
export const actions = {
  // ── workspaces & folders ─────────────────────────────────────────────────
  create_workspace:   { input: z.object({ name: text }),                         output: z.object({ workspace_id: id }) },
  create_folder:      { input: z.object({ workspace_id: id, name: text, parent_id: id.nullable().default(null),
                                          scope: z.enum(["threads", "library"]).default("library") }),
                        output: z.object({ folder_id: id }) },
  rename_folder:      { input: z.object({ folder_id: id, name: text }),          output: ok },
  move_folder:        { input: z.object({ folder_id: id, parent_id: id.nullable() }), output: ok },
  delete_folder:      { input: z.object({ folder_id: id }),                      output: ok },
  move_thread:        { input: z.object({ thread_id: id, folder_id: id.nullable() }), output: ok },

  // ── library ──────────────────────────────────────────────────────────────
  create_note:        { input: z.object({ workspace_id: id, name: text, content: z.string().default(""),
                                          folder_id: id.nullable().default(null),
                                          load_into_thread_id: id.optional(),
                                          exclude_message_id: id.optional() }),
                        output: z.object({ note_id: id }) },
  update_note:        { input: z.object({ note_id: id, name: text.optional(), content: z.string().optional() }), output: ok },
  move_note:          { input: z.object({ note_id: id, folder_id: id.nullable() }), output: ok },
  version_add_older:  { input: z.object({ note_id: id, newer_id: id }), output: ok },
  version_detach:     { input: z.object({ note_id: id }), output: ok },
  version_set_current:{ input: z.object({ note_id: id }), output: ok },
  version_set_newer:  { input: z.object({ note_id: id, newer_id: id }), output: ok },
  combine_notes:      { input: z.object({ workspace_id: id, note_ids: z.array(id).min(2), name: text, instructions: z.string().optional() }),
                        output: z.object({ note_id: id, run_id: id }) },
  revise_combine:     { input: z.object({ note_id: id, instructions: z.string().optional() }), output: z.object({ run_id: id }) },
  accept_combine:     { input: z.object({ note_id: id }),                        output: ok },
  retire_note:        { input: z.object({ note_id: id }),                        output: ok },
  reactivate_note:    { input: z.object({ note_id: id }),                        output: ok },
  delete_note:        { input: z.object({ note_id: id }),                        output: ok },

  // ── threads ──────────────────────────────────────────────────────────────
  create_thread:      { input: z.object({ workspace_id: id, name: text, kind: z.enum(["chat", "template"]).default("chat"),
                                          folder_id: id.nullable().default(null) }),
                        output: z.object({ thread_id: id }) },
  rename_thread:      { input: z.object({ thread_id: id, name: text }),          output: ok },
  delete_thread:      { input: z.object({ thread_id: id }),                      output: ok },
  duplicate_thread:   { input: z.object({ thread_id: id }),                      output: z.object({ thread_id: id }) },
  branch_thread:      { input: z.object({ message_id: id, name: text.optional() }), output: z.object({ thread_id: id }) },
  make_template:      { input: z.object({ thread_id: id }),                      output: z.object({ thread_id: id }) },

  // ── messages ─────────────────────────────────────────────────────────────
  send_message:       { input: z.object({ ...inThread, content: text, reply: z.boolean().default(false) }).refine(needsAHome, HOME),
                        output: z.object({ thread_id: id, message_id: id, run_id: id.nullable() }) },
  insert_message:     { input: z.object({ thread_id: id, after_message_id: id.nullable(), content: text,
                                          reply: z.boolean().default(false) }),
                        output: z.object({ message_id: id, run_id: id.nullable() }) },
  request_reply:      { input: z.object({ message_id: id }),                    output: z.object({ run_id: id }) },
  edit_message:       { input: z.object({ message_id: id, content: text, reply: z.boolean().default(false) }),
                        output: z.object({ run_id: id.nullable() }) },
  regenerate:         { input: z.object({ message_id: id }),                    output: z.object({ message_id: id, run_id: id }) },
  delete_message:     { input: z.object({ message_id: id }),                     output: ok },
  exclude_message:    { input: z.object({ message_id: id, excluded: z.boolean() }), output: ok },
  fold_message:       { input: z.object({ message_id: id, folded: z.boolean() }), output: ok },

  // ── context: library items in a thread ────────────────────────────────────
  place_item:         { input: z.object({ ...inThread, note_id: id }).refine(needsAHome, HOME),
                        output: z.object({ thread_id: id }) },
  reorder_items:      { input: z.object({ thread_id: id, ordered_ids: z.array(id) }), output: ok },
  remove_item:        { input: z.object({ thread_id: id, note_id: id }),        output: ok },
  // Add or remove a set of library items in one atomic step (one note, or a whole folder's notes).
  set_items:          { input: z.object({ ...inThread, note_ids: z.array(id), included: z.boolean() }).refine(needsAHome, HOME),
                        output: z.object({ thread_id: id }) },

  // ── summaries: drafting → review → accepted (a card) or discarded ─────────
  summarize:          { input: z.object({ message_ids: z.array(id).min(1), instructions: z.string().optional() }),
                        output: z.object({ summary_id: id, run_id: id }) },
  revise_summary:     { input: z.object({ summary_id: id, feedback: text.optional() }),
                        output: z.object({ summary_id: id, run_id: id }) },
  edit_summary:       { input: z.object({ summary_id: id, content: text }),      output: ok },
  accept_summary:     { input: z.object({ summary_id: id }),                     output: z.object({ message_id: id }) },
  discard_summary:    { input: z.object({ summary_id: id }),                     output: ok },

  // ── templates ────────────────────────────────────────────────────────────
  add_step:           { input: z.object({ thread_id: id, kind: stepKind, content: text }), output: z.object({ step_id: id }) },
  update_step:        { input: z.object({ step_id: id, kind: stepKind.optional(), content: text.optional() }), output: ok },
  remove_step:        { input: z.object({ step_id: id }),                        output: ok },
  reorder_steps:      { input: z.object({ thread_id: id, ordered_ids: z.array(id) }), output: ok },
  run_template:       { input: z.object({ thread_id: id, variables: z.record(z.string()) }),
                        output: z.object({ run_id: id, output_thread_id: id }) },

  // ── system message ────────────────────────────────────────────────────────
  set_system_message: { input: z.object({ text: z.string() }),                   output: ok },

  // ── model provider (app-wide) ─────────────────────────────────────────────
  // window: the model's context window as the provider listed it, when the app has it.
  set_llm:            { input: z.object({ provider: text, model_id: text, api_key: z.string().optional(), connection_id: id.optional(),
                                          window: z.number().int().positive().optional() }),
                        output: ok },
  add_connection:     { input: z.object({ name: text, url: z.string().url(), api_key: z.string().optional(), model_id: text,
                                          window: z.number().int().positive().optional() }),
                        output: z.object({ connection_id: id }) },
  remove_connection:  { input: z.object({ connection_id: id }),                output: ok },

  // ── agent defaults ───────────────────────────────────────────────────────
  set_agent_defaults: { input: z.object({ workspace_id: id, standing_instructions: z.string().optional(), permission: permission.optional() }),
                        output: ok },

  // ── runs ─────────────────────────────────────────────────────────────────
  // model and effort are Claude Code's own (--model, --effort); left out, it uses its own settings.
  // standing_instructions and permission left out: the workspace's.
  dispatch_agent:     { input: z.object({ ...inThread, task: text,
                          standing_instructions: z.string().optional(),
                          permission: permission.optional(),
                          model: z.enum(AGENT_MODELS).optional(),
                          effort: z.enum(AGENT_EFFORTS).optional() }).refine(needsAHome, HOME),
                        output: z.object({ thread_id: id, run_id: id }) },
  agent_follow_up:    { input: z.object({ message_id: id, message: text,
                          standing_instructions: z.string().optional(),
                          permission: permission.optional(),
                          model: z.enum(AGENT_MODELS).optional(),
                          effort: z.enum(AGENT_EFFORTS).optional() }),
                        output: z.object({ run_id: id }) },
  cancel_run:         { input: z.object({ run_id: id }),                         output: ok },
  mark_seen:          { input: z.object({ run_ids: z.array(id).min(1) }),        output: ok },
} as const;

export type ActionName = keyof typeof actions;
export type ActionInput<N extends ActionName> = z.input<(typeof actions)[N]["input"]>;
export type ActionArgs<N extends ActionName> = z.output<(typeof actions)[N]["input"]>;
export type ActionOutput<N extends ActionName> = z.output<(typeof actions)[N]["output"]>;
