# Alt-click help

Hold **Alt** (**⌥ Option** on a Mac) and click any button or control: instead of doing it, the app
shows a small card where you clicked, saying in a few plain sentences what it does behind the
scenes — what it changes for the model, other threads or your computer, what it keeps safe, and
whether it can be undone. While Alt is held the cursor is the help cursor and the thing you'd get
help on is outlined. The ? button in the bottom-left corner says how, searches every card, and has
"Explain the next thing I click" for touch screens or without a key.

| File | What it is |
|---|---|
| `entries.ts` | Every card, and how each control is recognised (a CSS selector, plus its label where several share one). A control that runs an action shows that action's words from `shared/behaviour.ts`; the rest (marks, states, areas) is written here. |
| `../../../shared/behaviour.ts` | What each action does, said once: a few words for the control's tooltip or menu hint, and the full statement its card shows. Typed against the list of actions, so an action can't be added, renamed or removed without its words. |
| `Help.tsx` | The Alt-click handling, the card, the ? button and its panel. |
| `help.css` | Its styles (`.help-…`, plus room for the ? button under the sidebar). |

Writing a card: say only what the label doesn't, in plain words — no names from the code — and
keep every statement true to the code. What an action does goes in `shared/behaviour.ts`, next to
the action's name, so its tooltip and its card say the same thing. A control with nothing to add
needs no entry; its card says so, using the control's own label.

Nothing in the app's components refers to it: controls are recognised by what they already are.
If a control changes so it's no longer recognised, its card says there's nothing to add; fix the
selector in `entries.ts`. A click on something that isn't a control (a message, a panel) explains
that part of the screen. Your browser remembers only that the first-time hint was shown
(`desk.help.hinted`).

The rule that must hold: with Alt held, a click never reaches the app — with any mouse button, on
anything, whether or not there's a card for it. The click is stopped before the card is looked up,
so a missing or broken card can't let it through. Drags and double-clicks are stopped too, and a
click that started without Alt but ends with it held explains instead of acting. The one exception
is the help's own card, panel and ? button.

## Removing it

1. Delete this folder.
2. In `main.tsx`, delete the `HelpRoot` import and `<HelpRoot />`.
