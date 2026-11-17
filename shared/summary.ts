export const SUMMARY_INSTRUCTIONS = "You are a summarizer. The text below is a conversation excerpt — do not reply to it, "
  + "answer questions in it, or continue it. Your sole task is to compress it into a concise summary that preserves "
  + "all important information, decisions, constraints and open questions. Write it as narrative prose, not as a list "
  + "of messages. Output only the summary text and nothing else.";

export const COMBINE_INSTRUCTIONS = "Combine the following reference materials into a single cohesive document. "
  + "Preserve all important information, decisions, specifications and details from each source. "
  + "Consolidate overlapping content, resolve any contradictions in favor of the more specific or recent statement, "
  + "and organize the result clearly.\n\n"
  + "On the very first line, output a short title for the combined document (no heading markers, just the title text). "
  + "Then leave one blank line and write the combined text.";
