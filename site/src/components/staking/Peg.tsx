import type { PegFile, PegHistoryFile } from '@ccip-dev/core/public';
import { useEffect, useState } from 'react';
import { trackDataError } from '../../lib/analytics';
import { fetchPublic } from '../../lib/data';
import { activeSide, episodeRows, formatGap, priceText, recordsView, routeRows, utcStamp } from '../../lib/peg-view';
import FreshnessNote from '../FreshnessNote';
import ShareButton from '../ShareButton';
import PegChart from './PegChart';

const POLL_MS = 60_000;

function Route({ peg, side, now }: { peg: PegFile; side: 'discount' | 'premium'; now: Date }) {
  const lit = activeSide(peg.gap) === side;
  return (
    <div className={lit ? 'panel peg-route lit' : 'panel peg-route'}>
      <p className="eyebrow">{side === 'discount' ? 'Discount route' : 'Premium route'}</p>
      <h3>{side === 'discount' ? 'Buy stLINK on Curve → redeem at 1:1' : 'Mint stLINK at 1:1 → sell on Curve'}</h3>
      <dl>
        {routeRows(peg, side, now).map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function Peg({ now }: { now: Date | null }) {
  const [peg, setPeg] = useState<PegFile | null>(null);
  const [history, setHistory] = useState<PegHistoryFile | null>(null);
  const [pegSettled, setPegSettled] = useState(false);
  const [historySettled, setHistorySettled] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const refresh = () =>
      fetchPublic('peg.json').then(
        (next) => {
          if (!live) return;
          setPeg(next);
          setFailed(false);
          setPegSettled(true);
        },
        () => {
          if (!live) return;
          setFailed(true);
          setPegSettled(true);
          trackDataError('peg.json');
        },
      );
    refresh();
    fetchPublic('peg-history.json').then(
      (next) => {
        if (!live) return;
        setHistory(next);
        setHistorySettled(true);
      },
      () => {
        if (!live) return;
        setHistorySettled(true);
        trackDataError('peg-history.json');
      },
    );
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (peg === null && history === null) {
    if (pegSettled && historySettled) return null;
    return (
      <section className="band" id="peg" aria-labelledby="peg-title">
        <div className="band-head">
          <p className="eyebrow">stLINK peg</p>
          <h2 id="peg-title">stLINK on Curve</h2>
          <p className="foot">Loading the peg…</p>
        </div>
      </section>
    );
  }
  const episode = peg?.episode ?? null;
  return (
    <section className="band" id="peg" aria-labelledby="peg-title">
      <div className="band-head">
        <p className="eyebrow">stLINK peg</p>
        <h2 id="peg-title">{peg ? <>{priceText(peg.spot)} <span className={peg.gap < 0 ? 'peg-gap down' : 'peg-gap up'}>{formatGap(peg.gap)}</span></> : 'stLINK on Curve'}</h2>
        <p className="lead">
          stake.link's stLINK is redeemable 1:1 for LINK in time. On Curve it trades freely: when it drifts, buying the cheap side and closing the loop through stake.link pays, if that route is open now.
          {episode ? ` A ${episode.side} has been running since ${utcStamp(episode.opened_at)}, peaking at ${formatGap(episode.peak_gap)}.` : ''}
        </p>
        <ShareButton view="peg" headline={peg ? `${priceText(peg.spot)} (${formatGap(peg.gap)})` : 'stLINK on Curve'} url="https://ccip.dev/staking/#peg" cardUrl="/og/peg.png" />
        {peg && <FreshnessNote updatedAt={peg.updated_at} paused={failed} />}
      </div>
      {peg && (
        <div className="peg-routes">
          <Route peg={peg} side="discount" now={now ?? new Date()} />
          <Route peg={peg} side="premium" now={now ?? new Date()} />
        </div>
      )}
      {history && now && <PegChart history={history} now={now} />}
      {history && now && (
        <dl className="peg-records">
          {recordsView(history, now).map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {history && history.episodes.length > 0 && (
        <div className="table-wrap peg-episodes">
          <table>
            <thead>
              <tr>
                <th>Episode</th>
                <th>From</th>
                <th className="num">Length</th>
                <th className="num">Peak</th>
              </tr>
            </thead>
            <tbody>
              {episodeRows(history).map((e) => (
                <tr key={`${e.side}-${e.when}-${e.length}`}>
                  <td>{e.side}</td>
                  <td>{e.when}</td>
                  <td className="num">{e.length}</td>
                  <td className="num">{e.peak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="foot">Curve depth is after pool fees, before gas. Not financial advice.</p>
    </section>
  );
}
