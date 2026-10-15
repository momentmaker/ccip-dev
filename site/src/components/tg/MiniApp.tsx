import { stickerPackUrl, type EnlistAnswer, type SessionAnswer } from '@ccip-dev/core/linkmarine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { backVisible, CCIPDEV_LINK, canShareToStory, DRAW_HOLD_MS, DRAW_STEP_MS, failureText, firstScreen, mainButton, shareLink, startParam, STORY_WIDGET, storyText, storyUrl, tgApi, toDogTag, type EnlistReply, type Screen } from '../../lib/tg';
import { telegramWebApp, type TelegramWebApp } from '../../lib/telegram-webapp';
import { useNow } from '../hooks';
import { useRoster } from '../marines/use-roster';
import { Boundary, OutOfReach } from './Boundary';
import DogTagScreen from './DogTagScreen';
import Draw from './Draw';
import Outside from './Outside';
import { MarineSheet, TagSheet } from './Sheets';
import TgRoster, { type RosterTab } from './TgRoster';
import { useBackButton, useLaunch, useMainButton, useOwnCard, useTilt } from './use-telegram';
import Welcome from './Welcome';

type Sheet = { tag: string } | { marine: number } | null;

const ENLIST_FAILED = "Couldn't enlist just now. Try again.";
const CHECK_FAILED = 'LinkMarines is out of reach right now. Try again in a minute.';

function InTelegram({ app }: { app: TelegramWebApp }) {
  const api = useMemo(() => tgApi(app.initData), [app]);
  const { roster } = useRoster();
  const now = useNow(60_000) ?? new Date();
  const [session, setSession] = useState<SessionAnswer | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [stack, setStack] = useState<Screen[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [tab, setTab] = useState<RosterTab>('wall');
  const [drawn, setDrawn] = useState<EnlistAnswer | null>(null);
  const [locked, setLocked] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const screen = stack.at(-1) ?? null;
  const open = session?.switch === 'on';
  const marine = session?.switch === 'on' ? session.marine : null;

  useLaunch(app);

  const loadSession = useCallback(async () => {
    try {
      const answer = await api.session();
      setSession(answer);
      setUnreachable(false);
      return answer;
    } catch (err) {
      console.warn(failureText(err));
      setUnreachable(true);
      return null;
    }
  }, [api]);

  useEffect(() => {
    void loadSession().then((answer) => {
      if (!answer) return;
      const first = firstScreen(startParam(app, window.location.search), answer);
      setStack([first]);
      if (first.name === 'roster') setSheet(first.marine !== null ? { marine: first.marine } : first.tag !== null ? { tag: first.tag } : null);
    });
  }, [app, loadSession]);

  const replaceStack = (next: Screen[]) => {
    setSheet(null);
    setStack(next);
  };
  const go = (next: Screen) => {
    setSheet(null);
    setStack((s) => [...s, next]);
  };
  const toMyDogTag = () => {
    setSheet(null);
    setStack(toDogTag);
  };
  const back = () => (sheet ? setSheet(null) : setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)));

  const enlist = async () => {
    setDrawn(null);
    setLocked(0);
    setNotice(null);
    go({ name: 'draw' });
    let reply: EnlistReply;
    try {
      reply = await api.enlist();
    } catch (err) {
      console.warn(failureText(err));
      setNotice(ENLIST_FAILED);
      replaceStack([{ name: 'welcome' }]);
      return;
    }
    if ('switch' in reply || 'gate' in reply) {
      setSession('switch' in reply ? reply : { switch: 'on', marine: null, gate: 'join' });
      replaceStack([{ name: 'welcome' }]);
      return;
    }
    setSession({ switch: 'on', marine: reply.marine, gate: 'ok' });
    if (reply.already) replaceStack([{ name: 'dogtag' }]);
    else setDrawn(reply);
  };

  useEffect(() => {
    if (!drawn) return;
    const timers = [1, 2, 3].map((n) =>
      setTimeout(() => {
        setLocked(n);
        app.HapticFeedback.impactOccurred('medium');
        if (n === 3 && drawn.banner) app.HapticFeedback.notificationOccurred('success');
      }, n * DRAW_STEP_MS),
    );
    timers.push(setTimeout(() => replaceStack([{ name: 'dogtag' }]), 3 * DRAW_STEP_MS + DRAW_HOLD_MS));
    return () => timers.forEach(clearTimeout);
  }, [drawn, app]);

  const onDogTag = screen?.name === 'dogtag' && marine !== null;
  const ownCard = useOwnCard(api.card, onDogTag ? marine.serial : null);
  const tilt = useTilt(app, onDogTag && ownCard !== null);

  const button = mainButton(screen?.name ?? 'welcome', screen ? session : null);
  useMainButton(app, button, () => {
    if (button.action === 'enlist') void enlist();
    else if (button.action === 'dogtag') toMyDogTag();
    else if (button.action === 'story' && marine) {
      if (canShareToStory(app)) app.shareToStory(storyUrl(marine.serial), { text: storyText(marine), widget_link: STORY_WIDGET });
      else app.openTelegramLink(shareLink(marine));
    }
  });
  useBackButton(app, backVisible(screen?.name ?? null, stack.length, sheet !== null), back);

  if (!screen) {
    return unreachable ? (
      <OutOfReach />
    ) : (
      <p className="tg-state" aria-busy="true">
        Loading…
      </p>
    );
  }
  return (
    <>
      {screen.name === 'welcome' && (
        <Welcome
          roster={roster}
          gate={session?.switch === 'on' ? session.gate : 'join'}
          open={open}
          notice={notice}
          onJoin={() => app.openTelegramLink(CCIPDEV_LINK)}
          onCheck={() => {
            setNotice(null);
            void loadSession().then((answer) => {
              if (!answer) setNotice(CHECK_FAILED);
            });
          }}
        />
      )}
      {screen.name === 'draw' && <Draw marine={drawn?.marine ?? null} roster={roster} locked={locked} banner={drawn?.banner ?? null} />}
      {screen.name === 'dogtag' && marine && (
        <DogTagScreen
          marine={marine}
          cardUrl={ownCard?.url ?? null}
          ownCard={ownCard?.own ?? false}
          tilt={tilt}
          onPack={() => app.openTelegramLink(stickerPackUrl(marine.volume))}
          onShare={() => app.openTelegramLink(shareLink(marine))}
          onRoster={() => go({ name: 'roster', marine: null, tag: null })}
        />
      )}
      {screen.name === 'roster' &&
        (roster ? (
          <TgRoster roster={roster} tab={tab} now={now} open={open} onTab={setTab} onPickTag={(tag) => setSheet({ tag })} onPickMarine={(serial) => setSheet({ marine: serial })} />
        ) : (
          <p className="tg-state" aria-busy="true">
            Loading the roster…
          </p>
        ))}
      {screen.name === 'roster' && sheet && roster && ('tag' in sheet ? <TagSheet roster={roster} tag={sheet.tag} onClose={() => setSheet(null)} /> : <MarineSheet roster={roster} serial={sheet.marine} onClose={() => setSheet(null)} />)}
    </>
  );
}

/** The LinkMarines Mini App: inside Telegram the four screens, in a plain browser a pointer to Telegram. */
export default function MiniApp() {
  const [app, setApp] = useState<TelegramWebApp | null | undefined>(undefined);
  useEffect(() => setApp(telegramWebApp(window as unknown as Parameters<typeof telegramWebApp>[0])), []);
  if (app === undefined) return null;
  return (
    <div className="tg">
      {app ? (
        <Boundary>
          <InTelegram app={app} />
        </Boundary>
      ) : (
        <Outside />
      )}
    </div>
  );
}
