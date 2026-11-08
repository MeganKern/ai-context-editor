import { z } from "zod";

const id = z.string().min(1);
const ok = z.object({ ok: z.literal(true) });
const text = z.string().min(1);
/** A place in an ordered list, 0 = first. Left out: the end. */
const at = z.number().int().min(0).optional();

/**
 * Every write the client can ask for. Each is one intent and runs as one transaction on the
 * server, recorded as one change set: there's no multi-step sequence for the client to finish.
 * What each one does, in words, is in shared/behaviour.ts.
 */
export const actions = {
  // ── workspaces & folders ─────────────────────────────────────────────────
  create_workspace:   { input: z.object({ name: text }),                         output: z.object({ workspace_id: id }) },
  create_folder:      { input: z.object({ workspace_id: id, name: text }),       output: z.object({ folder_id: id }) },
  rename_folder:      { input: z.object({ folder_id: id, name: text }),          output: ok },
  delete_folder:      { input: z.object({ folder_id: id }),                      output: ok },
  move_thread:        { input: z.object({ thread_id: id, folder_id: id.nullable() }), output: ok },

  // ── library ──────────────────────────────────────────────────────────────
  create_note:        { input: z.object({ workspace_id: id, name: text, content: z.string().default(""),
                                          load_into_thread_id: id.optional() }),
                        output: z.object({ note_id: id }) },
  update_note:        { input: z.object({ note_id: id, name: text.optional(), content: z.string().optional() }), output: ok },
  duplicate_note:     { input: z.object({ note_id: id }),                        output: z.object({ note_id: id }) },
  delete_note:        { input: z.object({ note_id: id }),                        output: ok },

  // ── threads ──────────────────────────────────────────────────────────────
  create_thread:      { input: z.object({ workspace_id: id, name: text, kind: z.enum(["chat", "template"]).default("chat"),
                                          folder_id: id.nullable().default(null) }),
                        output: z.object({ thread_id: id }) },
  rename_thread:      { input: z.object({ thread_id: id, name: text }),          output: ok },
  set_thread_model:   { input: z.object({ thread_id: id, model: z.string().nullable() }), output: ok },
  delete_thread:      { input: z.object({ thread_id: id }),                      output: ok },
  duplicate_thread:   { input: z.object({ thread_id: id }),                      output: z.object({ thread_id: id }) },
  branch_thread:      { input: z.object({ message_id: id, name: text.optional() }), output: z.object({ thread_id: id }) },
  make_template:      { input: z.object({ thread_id: id }),                      output: z.object({ thread_id: id }) },
  generate_title:     { input: z.object({ thread_id: id }),                      output: z.object({ run_id: id }) },

  // ── messages ─────────────────────────────────────────────────────────────
  send_message:       { input: z.object({ thread_id: id, content: text, reply: z.boolean().default(false),
                                          note_ids: z.array(id).default([]) }),
                        output: z.object({ message_id: id, run_id: id.nullable() }) },
  insert_message:     { input: z.object({ thread_id: id, after_message_id: id.nullable(), content: text,
                                          reply: z.boolean().default(false) }),
                        output: z.object({ message_id: id, run_id: id.nullable() }) },
  request_reply:      { input: z.object({ message_id: id }),                     output: z.object({ run_id: id }) },
  edit_message:       { input: z.object({ message_id: id, content: text, then: z.enum(["reply"]).nullable().default(null) }),
                        output: z.object({ run_id: id.nullable() }) },
  regenerate:         { input: z.object({ message_id: id }),                     output: z.object({ message_id: id, run_id: id }) },
  delete_message:     { input: z.object({ message_id: id }),                     output: ok },
  set_message_flags:  { input: z.object({ message_id: id, excluded: z.boolean().optional(), folded: z.boolean().optional() }),
                        output: ok },

  // ── context: pins, library items in a thread, switches ───────────────────
  pin_directive:      { input: z.object({ thread_id: id, text, source_message_id: id.optional() }), output: z.object({ directive_id: id }) },
  update_directive:   { input: z.object({ directive_id: id, text }),            output: ok },
  unpin_directive:    { input: z.object({ directive_id: id }),                   output: ok },
  reorder_directives: { input: z.object({ thread_id: id, ordered_ids: z.array(id) }), output: ok },
  convert_directive_to_note: { input: z.object({ directive_id: id, load: z.boolean(), at }), output: z.object({ note_id: id }) },
  place_item:         { input: z.object({ thread_id: id, note_id: id, place: z.discriminatedUnion("placement", [
                          z.object({ placement: z.literal("every_reply"), at }),
                          z.object({ placement: z.literal("with_message"), message_id: id }),
                        ]) }),
                        output: ok },
  reorder_items:      { input: z.object({ thread_id: id, ordered_note_ids: z.array(id) }), output: ok },
  remove_item:        { input: z.object({ thread_id: id, note_id: id }),        output: ok },
  use_own_copy:       { input: z.object({ thread_id: id, note_id: id }),        output: z.object({ note_id: id }) },
  set_excluded:       { input: z.discriminatedUnion("target", [
                          z.object({ target: z.literal("directive"), directive_id: id, excluded: z.boolean() }),
                          z.object({ target: z.literal("item"), thread_id: id, note_id: id, excluded: z.boolean() }),
                        ]),
                        output: ok },
  set_excluded_all:   { input: z.object({ thread_id: id, target: z.enum(["directives", "items"]), excluded: z.boolean() }),
                        output: ok },

  // ── summaries: drafting → review → active ⇄ inactive, or discarded ───────
  summarize:          { input: z.object({ cards: z.array(z.object({ message_id: id.optional(), summary_id: id.optional() })
                          .refine(c => !!c.message_id !== !!c.summary_id, "Each card is a message or a summary")).min(1) }),
                        output: z.object({ summary_id: id, run_id: id }) },
  revise_summary:     { input: z.object({ summary_id: id, feedback: text.optional() }),
                        output: z.object({ summary_id: id, run_id: id }) },
  edit_summary:       { input: z.object({ summary_id: id, content: text }),
                        output: ok },
  set_summary_status: { input: z.object({ summary_id: id, status: z.enum(["active", "inactive", "discarded"]) }), output: ok },

  // ── templates ────────────────────────────────────────────────────────────
  add_step:           { input: z.object({ thread_id: id, kind: z.enum(["post", "reply", "agent"]), content: text,
                                          position: z.number().int().optional() }),
                        output: z.object({ step_id: id }) },
  update_step:        { input: z.object({ step_id: id, kind: z.enum(["post", "reply", "agent"]).optional(), content: text.optional() }),
                        output: ok },
  remove_step:        { input: z.object({ step_id: id }),                        output: ok },
  reorder_steps:      { input: z.object({ thread_id: id, ordered_ids: z.array(id) }), output: ok },
  run_template:       { input: z.object({ thread_id: id, variables: z.record(z.string()) }),
                        output: z.object({ run_id: id, output_thread_id: id }) },

  // ── agent config ─────────────────────────────────────────────────────────
  set_agent_defaults: { input: z.object({ workspace_id: id,
                          preamble: z.string().optional(),
                          permission: z.enum(["locked", "standard", "full"]).optional() }),
                        output: ok },

  // ── runs ─────────────────────────────────────────────────────────────────
  dispatch_agent:     { input: z.object({ thread_id: id, task: text,
                          preamble: z.string().optional(),
                          permission: z.enum(["locked", "standard", "full"]).optional(),
                          effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional() }),
                        output: z.object({ run_id: id }) },
  agent_follow_up:    { input: z.object({ message_id: id, message: text,
                          preamble: z.string().optional(),
                          permission: z.enum(["locked", "standard", "full"]).optional(),
                          effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional() }),
                        output: z.object({ run_id: id }) },
  cancel_run:         { input: z.object({ run_id: id }),                         output: ok },
  mark_seen:          { input: z.object({ run_ids: z.array(id).min(1) }),        output: ok },
} as const;

export type ActionName = keyof typeof actions;
export type ActionInput<N extends ActionName> = z.input<(typeof actions)[N]["input"]>;
export type ActionArgs<N extends ActionName> = z.output<(typeof actions)[N]["input"]>;
export type ActionOutput<N extends ActionName> = z.output<(typeof actions)[N]["output"]>;
