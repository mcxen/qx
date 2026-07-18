import { useState } from "react";
import QxLoadingMark, { type QxLoadingMarkVariant } from "./QxLoadingMark";
import { Button } from "./ui";
import { useT } from "../i18n";
import "../App.css";

const STUDIES: Array<{ variant: QxLoadingMarkVariant; titleKey: string; title: string; noteKey: string; note: string }> = [
  { variant: "cascade", titleKey: "loadingLab.cascade", title: "Cascade", noteKey: "loadingLab.cascade.note", note: "Quarter-turns travel from small to large." },
  { variant: "sync", titleKey: "loadingLab.sync", title: "Synchronous", noteKey: "loadingLab.sync.note", note: "All three tiles rotate as one steady signal." },
  { variant: "flip", titleKey: "loadingLab.flip", title: "Flip", noteKey: "loadingLab.flip.note", note: "A staggered face flip with a softer rhythm." },
  { variant: "pulse", titleKey: "loadingLab.pulse", title: "Pulse", noteKey: "loadingLab.pulse.note", note: "Short turns gather energy around the center." },
];

export default function LoadingMarkLab() {
  const t = useT();
  const [active, setActive] = useState(true);

  return (
    <main className="qx-loading-lab">
      <header className="qx-loading-lab__header">
        <div>
          <p className="qx-loading-lab__eyebrow">Qx Motion Study</p>
          <h1>{t("loadingLab.title", "Loading Mark Lab")}</h1>
          <p>{t("loadingLab.subtitle", "One SVG mark, four reusable motion directions.")}</p>
        </div>
        <Button variant="outline" onClick={() => setActive((value) => !value)}>
          {active ? t("loadingLab.pause", "Pause all") : t("loadingLab.play", "Play all")}
        </Button>
      </header>

      <section className="qx-loading-lab__grid" aria-label={t("loadingLab.variants", "Animation variants")}>
        {STUDIES.map((study) => (
          <article className="qx-loading-lab__card" key={study.variant}>
            <div className="qx-loading-lab__stage">
              <QxLoadingMark
                variant={study.variant}
                active={active}
                size={176}
                label={t(study.titleKey, study.title)}
              />
            </div>
            <div className="qx-loading-lab__copy">
              <strong>{t(study.titleKey, study.title)}</strong>
              <span>{t(study.noteKey, study.note)}</span>
              <code>variant=&quot;{study.variant}&quot;</code>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
