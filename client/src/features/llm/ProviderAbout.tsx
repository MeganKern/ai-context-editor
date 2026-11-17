import { useModel } from "../../data/model.js";
import { activity } from "../../session/activity.js";
import { Dialog } from "../../kit/Dialog.js";
import { Button } from "../../kit/Button.js";

/** What a provider is, in its own words, with where to read more. */
export function ProviderAbout({ providerId }: { providerId: string }) {
  const p = useModel(s => s.app?.catalog.find(x => x.id === providerId));
  const close = () => activity.close();
  if (!p?.about) return null;
  return (
    <Dialog compact title={`About ${p.label}`} onClose={close} help="llm.about" actions={<Button kind="primary" onClick={close}>Close</Button>}>
      <div className="llm-about">
        {p.about.text.map((t, i) => <p key={i}>{t}</p>)}
        <div className="llm-about-links">
          {p.about.links.map(l => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>)}
        </div>
      </div>
    </Dialog>
  );
}
