// The bar that appears when something is selected: what smart ink and the learning tools can do with it.
import { FLOW_COLOURS, FLOW_KINDS, type FlowKind } from '../learn/FlowLayer';

export type Selection = {
  ids: string[];
  freedraw: number;
  arrows: number;
  shapes: number;
  step: number | 'mixed';
  flow: boolean;
  flowKind: FlowKind | null;
  flowColour: string | null;
  cover: boolean;
};

type Props = {
  sel: Selection;
  busy: string | null;
  alternatives: string[];
  onPerfect: () => void;
  onText: () => void;
  onStraighten: () => void;
  onFlow: () => void;
  onFlowKind: (k: FlowKind) => void;
  onFlowColour: (c: string) => void;
  defaultFlowColour: string;
  onCover: () => void;
  onStep: (delta: number | 'next' | 'clear') => void;
  onMark: (mark: 'ok' | 'cross') => void;
  onAlternative: (value: string) => void;
};

export function SmartBar({ sel, busy, alternatives, ...a }: Props) {
  const alt = navigator.platform.toLowerCase().includes('mac') ? '⌥' : 'Alt+';
  return (
    <div className="lb-smartbar" role="toolbar" aria-label="Selection tools">
      {sel.freedraw > 0 && (
        <>
          <button type="button" className="lb-btn" onClick={a.onPerfect} title={`Perfect the shape (${alt}P, or double-click it)`}>✨ Perfect</button>
          <button type="button" className="lb-btn" onClick={a.onText} disabled={!!busy} title={`Handwriting to neat text (${alt}W) — needs internet`}>{busy === 'text' ? 'Reading…' : 'Aa To text'}</button>
          <button type="button" className="lb-btn" onClick={a.onStraighten} title={`Line up your handwriting (${alt}L)`}>≡ Straighten</button>
          <span className="lb-sep" />
        </>
      )}
      {sel.arrows > 0 && (
        <>
          <button type="button" className={`lb-btn${sel.flow ? ' on' : ''}`} onClick={a.onFlow} title={`Dots flowing along it (${alt}F)`}>● → Flow</button>
          {sel.flow && (
            <span className="lb-flowpick" role="group" aria-label="Kind of flow">
              {FLOW_KINDS.map((k) => (
                <button key={k.id} type="button" className={`lb-chip${sel.flowKind === k.id ? ' on' : ''}`} onClick={() => a.onFlowKind(k.id)} title={k.name}>
                  <span className={`lb-flowicon ${k.id}`} aria-hidden="true" />{k.name}
                </button>
              ))}
              {FLOW_COLOURS.map((c) => (
                <button key={c} type="button" className={`lb-swatch${(sel.flowColour ?? a.defaultFlowColour) === c ? ' on' : ''}`} style={{ background: c }} onClick={() => a.onFlowColour(c)} aria-label={`Flow colour ${c}`} />
              ))}
            </span>
          )}
          <span className="lb-sep" />
        </>
      )}
      <span className="lb-step" title="In Play, these appear at this step">
        <button type="button" className="lb-btn" onClick={() => a.onStep(-1)} aria-label="Earlier step">−</button>
        <span className="lb-step-val">{sel.step === 'mixed' ? 'mixed' : sel.step === 0 ? 'always' : `step ${sel.step}`}</span>
        <button type="button" className="lb-btn" onClick={() => a.onStep(1)} aria-label="Later step">+</button>
        <button type="button" className="lb-btn" onClick={() => a.onStep('next')} title={`Make these the next step (${alt}N)`}>Next step</button>
      </span>
      {sel.shapes > 0 && (
        <>
          <button type="button" className={`lb-btn${sel.cover ? ' on' : ''}`} onClick={a.onCover} title={`Hide under a card in Play until clicked (${alt}Q)`}>? Quiz</button>
          {typeof sel.step === 'number' && sel.step > 0 && (
            <>
              <button type="button" className="lb-btn" onClick={() => a.onMark('ok')} title="Green tick during its step">✓</button>
              <button type="button" className="lb-btn" onClick={() => a.onMark('cross')} title="Red cross during its step">✗</button>
            </>
          )}
        </>
      )}
      {alternatives.length > 0 && (
        <span className="lb-alts">
          <small>or:</small>
          {alternatives.map((v) => (
            <button key={v} type="button" className="lb-btn" onClick={() => a.onAlternative(v)}>{v}</button>
          ))}
        </span>
      )}
    </div>
  );
}
